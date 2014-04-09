An experiments on WebGL which based on deferred shading. There are 3 passes in the demo:

1. The geometry pass fills normal, eye space depth and albedo buffer(texture) with corresponding data information. The normal information is calculated from a bump map texture.

2. The lighting pass reconstruct eye space position from depth buffer, and sample normal and albedo texture to produce diffuse and specular lighting result.

3. The final result texture is mapped to a screen sized quad to display on the browser.