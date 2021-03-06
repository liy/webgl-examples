function DeferredRenderer(){
  this.canvas = document.createElement('canvas');
  document.body.appendChild(this.canvas);
  this.canvas.width = window.innerWidth;
  this.canvas.height = window.innerHeight;
  window.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');

  this.GBufferWidth = 1280;
  this.GBufferHeight = 1280;

  window.addEventListener('resize', this.onResize);

  this.dbExt = gl.getExtension("WEBGL_draw_buffers");
  this.dtExt = gl.getExtension("WEBGL_depth_texture");
  this.vaoExt = gl.getExtension("OES_vertex_array_object");

  // include extensions' properties into gl, for convenience reason.
  var exts = [this.dbExt, this.dtExt, this.vaoExt];
  ExtensionCheck.check(exts);

  for(var i=0; i<exts.length; ++i){
    var ext = exts[i];
    for(var name in ext){
      if(gl[name] === undefined){
        if(ext[name] instanceof Function){
          (function(e, n){
            gl[n] = function(){
              return e[n].apply(e, arguments);
            }
          })(ext, name);
        }
        else
          gl[name] = ext[name];
      }
      else
        console.error('gl conflict name in extension: ' + ext +' name: ' + name);
    }
  }

  // filling g-buffers
  this.gbufferProgram = gl.createProgram();
  this.gbufferShader = new Shader(this.gbufferProgram, 'shader/gbuffer_color_depth.vert', 'shader/gbuffer_color_depth.frag');
  gl.useProgram(this.gbufferProgram);
  this.gbufferShader.locateAttributes(this.gbufferProgram);
  this.gbufferShader.locateUniforms(this.gbufferProgram);

  // point light calculation
  this.pointLightProgram = gl.createProgram();
  this.pointLightShader = new Shader(this.pointLightProgram, 'shader/light/point_color_depth.vert', 'shader/light/point_color_depth.frag');
  gl.useProgram(this.pointLightProgram);
  this.pointLightShader.locateAttributes(this.pointLightProgram);
  this.pointLightShader.locateUniforms(this.pointLightProgram);

  // directional light calculation
  this.dirLightProgram = gl.createProgram();
  this.dirLightShader = new Shader(this.dirLightProgram, 'shader/light/directional.vert', 'shader/light/directional.frag');
  gl.useProgram(this.dirLightProgram);
  this.dirLightShader.locateAttributes(this.dirLightProgram);
  this.dirLightShader.locateUniforms(this.dirLightProgram);

  // null shader for stencil update
  this.stencilProgram = gl.createProgram();
  this.stencilShader = new Shader(this.stencilProgram, 'shader/stencil.vert', 'shader/stencil.frag');
  gl.useProgram(this.stencilProgram);
  this.stencilShader.locateAttributes(this.stencilProgram);
  this.stencilShader.locateUniforms(this.stencilProgram);

  // put on to screen
  this.screenProgram = gl.createProgram();
  this.screenShader = new Shader(this.screenProgram, 'shader/screen.vert', 'shader/screen.frag');
  gl.useProgram(this.screenProgram);
  this.screenShader.locateAttributes(this.screenProgram);
  this.screenShader.locateUniforms(this.screenProgram);

  // both depth color and depth stencil will be shared by gbuffer framebuffer and composition framebuffer.
  this.depthColorTarget = this._createColorDepthTexture(this.GBufferWidth, this.GBufferHeight);
  this.depthStencilRenderBuffer = this._createDepthStencilRenderBuffer(this.GBufferWidth, this.GBufferHeight);

  this.createGBuffers();
  this.createCompositionFrameBuffers();

  this.createScreenBuffer();

  gl.clearColor(0.2, 0.2, 0.2, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}
var p = DeferredRenderer.prototype;

p.createGBuffers = function(){
  // Create multiple textures for filling g-buffer
  this.albedoTarget = this._createColorTexture(this.GBufferWidth, this.GBufferHeight);
  this.normalTarget = this._createColorTexture(this.GBufferWidth, this.GBufferHeight);
  this.specularTarget = this._createColorTexture(this.GBufferWidth, this.GBufferHeight);

  // framebuffer to attach both textures and depth renderbuffer
  this.gFrameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.gFrameBuffer);
  // specify 3 textures as render targets
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albedoTarget, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+1, gl.TEXTURE_2D, this.normalTarget, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+2, gl.TEXTURE_2D, this.specularTarget, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+3, gl.TEXTURE_2D, this.depthColorTarget, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.depthStencilRenderBuffer);

  // Specifies a list of color buffers to be drawn into
  gl.drawBuffersWEBGL([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT0+1, gl.COLOR_ATTACHMENT0+2, gl.COLOR_ATTACHMENT0+3]);
}

p.createCompositionFrameBuffers = function(){
  this.compositionTexture = this._createColorTexture(this.GBufferWidth, this.GBufferHeight);

  this.cFrameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.cFrameBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.compositionTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+1, gl.TEXTURE_2D, this.depthColorTarget, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.depthStencilRenderBuffer);
}

p.render = function(scene, camera){
  gl.useProgram(this.gbufferProgram);

  // update all object's matrix.
  var len = scene.children.length;
  for(var i=0; i<len; ++i){
    scene.children[i].update(this.gbufferShader);
  }

  // calculated view dependent matrix(model view matrix and normal matrix, etc.)
  len = scene.meshes.length;
  for(var i=0; i<len; ++i){
    var mesh = scene.meshes[i];
    // update model view matrix, normal matrix
    mat4.mul(mesh.modelViewMatrix, camera.viewMatrix, mesh.worldMatrix);
    mat3.normalFromMat4(mesh.modelViewMatrixInverseTranspose, mesh.modelViewMatrix);
  }
  // draw to g-buffers
  this.drawGBuffers(scene, camera);

  // do lighting
  this.composite(scene, camera);

  // draw to screen
  this.drawScreen();
}


p.drawGBuffers = function(scene, camera){
  // enable depth buffer
  gl.depthMask(true);

  // g-buffers render
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.gFrameBuffer);
  gl.viewport(0, 0, this.GBufferWidth, this.GBufferHeight);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  // cull face needs to be enabled during G-buffer filling
  gl.enable(gl.CULL_FACE);
  // depth test of course is needed
  gl.enable(gl.DEPTH_TEST);
  // TODO: disable blend for now for G-Buffer, future needs support transparency.
  gl.disable(gl.BLEND);

  // camera
  gl.uniformMatrix4fv(this.gbufferShader.uniforms['u_ProjectionMatrix'], false, camera.projectionMatrix);
  gl.uniformMatrix4fv(this.gbufferShader.uniforms['u_ViewMatrix'], false, camera.viewMatrix);

  // meshes
  len = scene.meshes.length;
  for(var i=0; i<len; ++i){
    var mesh = scene.meshes[i];

    // normal, model view matrix
    gl.uniformMatrix4fv(this.gbufferShader.uniforms['u_ModelMatrix'], false, mesh.worldMatrix);
    gl.uniformMatrix4fv(this.gbufferShader.uniforms['u_ModelViewMatrix'], false, mesh.modelViewMatrix);
    gl.uniformMatrix3fv(this.gbufferShader.uniforms['u_ModelViewMatrixInverseTranspose'], false, mesh.modelViewMatrixInverseTranspose);

    mesh.draw(this.gbufferShader);
  }

  // now you have finished filling the G-Buffers, the depth information is recorded.
  // Lighting pass should only read the depth information.
  gl.depthMask(false);
}

p.stencil = function(light, camera){
  // TODO: use stencil shader program
  gl.useProgram(this.stencilProgram);
  gl.uniformMatrix4fv(this.stencilShader.uniforms['u_ProjectionMatrix'], false, camera.projectionMatrix);

  // needs depth test to correctly increase stencil buffer
  gl.enable(gl.DEPTH_TEST);
  // needs both faces to correctly increase stencil buffer
  gl.disable(gl.CULL_FACE);
  // stencil buffer is refreshed for each light 
  gl.clear(gl.STENCIL_BUFFER_BIT);
  // always write to stencil buffer in stencil stage.
  gl.stencilFunc(gl.ALWAYS, 0, 0);
  // increase and decrease the stencil according to the rule:
  // http://ogldev.atspace.co.uk/www/tutorial37/tutorial37.html
  gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.INCR_WRAP, gl.KEEP);
  gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.DECR_WRAP, gl.KEEP);
  
  // only stencil write is needed, do not write to color buffer, save some processing power
  gl.colorMask(false, false, false, false);
  light.draw(this.stencilShader, camera);
}

p.lighting = function(light, camera){
   // use point light program
  gl.useProgram(this.pointLightProgram);
  // FIXIME: TODO: move these const uniform into camera initialization method
  gl.uniformMatrix4fv(this.pointLightShader.uniforms['u_ProjectionMatrix'], false, camera.projectionMatrix);
  gl.uniformMatrix4fv(this.pointLightShader.uniforms['u_InvProjectionMatrix'], false, camera.invertProjectionMatrix);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.albedoTarget);
  gl.uniform1i(this.pointLightShader.uniforms['albedoTarget'], 0);
  gl.activeTexture(gl.TEXTURE0+1);
  gl.bindTexture(gl.TEXTURE_2D, this.normalTarget);
  gl.uniform1i(this.pointLightShader.uniforms['normalTarget'], 1);
  gl.activeTexture(gl.TEXTURE0+2);
  gl.bindTexture(gl.TEXTURE_2D, this.specularTarget);
  gl.uniform1i(this.pointLightShader.uniforms['specularTarget'], 2);
  gl.activeTexture(gl.TEXTURE0+3);
  gl.bindTexture(gl.TEXTURE_2D, this.depthColorTarget);
  gl.uniform1i(this.pointLightShader.uniforms['depthColorTarget'], 3);
  
  // all light volumes need to be drawn
  gl.disable(gl.DEPTH_TEST);
  // alway cull front face and leave the back face of light volume for lighting.
  // Since once camera pass back face of the volume, it should not affecting anything in front of the camera.
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);

  // lighting effect will have none-zero stencil value.
  gl.stencilFunc(gl.NOTEQUAL, 0, 0xFF);
  
  // enable color drawing
  gl.colorMask(true, true, true, true);
  light.draw(this.pointLightShader, camera);
}

p.composite = function(scene, camera){
  // draw to the default screen framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.cFrameBuffer);

  gl.viewport(0, 0, this.GBufferWidth, this.GBufferHeight);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // light composition blend: add
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE);

  // enable stencil for stencil pass
  gl.enable(gl.STENCIL_TEST);

  len = scene.lights.length;
  for(var i=0; i<len; ++i){
    var pointLight = scene.lights[i];

    // TODO: move this to update method
    // update light's view based matrix
    mat4.mul(pointLight.modelViewMatrix, camera.viewMatrix, pointLight.worldMatrix);
    vec3.transformMat4(pointLight._viewSpacePosition, pointLight._position, camera.viewMatrix);

    // fill stencil buffer for each light, since different light
    this.stencil(pointLight, camera);

    this.lighting(pointLight, camera);
   }
  
  // disable stencil test for directional lighting
  gl.disable(gl.STENCIL_TEST);
  // switch back to normal back face culling, for geometry rendering next frame
  gl.cullFace(gl.BACK)
}

p.drawScreen = function(){
  gl.useProgram(this.screenProgram);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.compositionTexture);
  gl.uniform1i(this.screenShader.uniforms['texture'], 0);

  gl.bindVertexArrayOES(this.screenVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArrayOES(null);
}



















function sort(camera){
  return function(a, b){
    // if(a.translucent != b.translucent){
    //   if(b.translucent)
    //     return 1;
    //   else
    //     return -1;
    // }

    // if(a.texture != b.texture){
    //   if(a.texture < b.texture)
    //     return 1;
    //   else
    //     return -1;
    // }

    // if(a.depth != b.depth){
    //   if(a.depth < b.depth)
    //     return (a.translucent) ? -1 : 1;
    //   else if(a.depth == b.depth)
    //     return 0;
    //   else
    //     return (!a.translucent) ? -1 : 1;
    // }

    // return 0;

    if(a.material.name != b.material.name){
      if(a.material.name < b.material.name)
        return 1;
      else
        return -1;
    }

    vec3.transformMat4(a._viewSpacePosition, a._position, camera.viewMatrix);
    vec3.transformMat4(b._viewSpacePosition, b._position, camera.viewMatrix);


    if(a._viewSpacePosition[2] < b._viewSpacePosition[2])
      return 1;
    else if(a._viewSpacePosition[2] > b._viewSpacePosition[2])
      return -1
    else
      return 0;
  }
}

p.createScreenBuffer = function(){
  this.screenVAO = gl.createVertexArrayOES();
  gl.bindVertexArrayOES(this.screenVAO);

  // Screen attributes buffer
  var vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1.0, -1.0,
                                                     1.0, -1.0,
                                                     1.0,  1.0,
                                                     1.0,  1.0,
                                                    -1.0,  1.0,
                                                    -1.0, -1.0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(this.screenShader.attributes.a_Vertex);
  gl.vertexAttribPointer(this.screenShader.attributes.a_Vertex, 2, gl.FLOAT, false, 0, 0);
  // texture coordinate buffer
  var tb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0,
                                                   1, 0,
                                                   1, 1,
                                                   1, 1,
                                                   0, 1,
                                                   0, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(this.screenShader.attributes.a_TexCoord);
  gl.vertexAttribPointer(this.screenShader.attributes.a_TexCoord, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArrayOES(null);
}

p._createColorTexture = function(w, h){
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  return texture;
}

p._createDepthTexture = function(w, h){
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);

  return texture;
}

/**
 * You should encode depth data into RGBA manually.
 */
p._createColorDepthTexture = function(w, h){
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  return texture;
}

p._createDepthStencilTexture = function(w, h){
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // this requires WEBKIT_WEBGL_depth_texture extension, notice the type of the data must be: UNSIGNED_INT_24_8_WEBGL
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_STENCIL, w, h, 0, gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8_WEBGL, null);

  return texture;
}

p._createDepthStencilRenderBuffer = function(w, h){
  var renderbuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);

  return renderbuffer;
}

p.onResize = function(e){

}