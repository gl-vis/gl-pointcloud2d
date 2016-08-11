'use strict'

var createShader = require('gl-shader')
var createBuffer = require('gl-buffer')

var pool = require('typedarray-pool')

var SHADERS = require('./lib/shader')

module.exports = createScatter2D

function Scatter2D(plot, offsetBuffer, pickBuffer, shader, pickShader) {
  this.plot           = plot
  this.offsetBuffer   = offsetBuffer
  this.pickBuffer     = pickBuffer
  this.shader         = shader
  this.pickShader     = pickShader
  this.size           = 12.0
  this.borderSize     = 1.0
  this.pointCount     = 0
  this.color          = [1, 0, 0, 1]
  this.borderColor    = [0, 0, 0, 1]
  this.bounds         = [Infinity, Infinity, -Infinity, -Infinity]
  this.pickOffset     = 0
  this.points         = null
}

var proto = Scatter2D.prototype

proto.dispose = function() {
  this.shader.dispose()
  this.pickShader.dispose()
  this.offsetBuffer.dispose()
  this.pickBuffer.dispose()
  this.plot.removeObject(this)
}

proto.update = function(options) {

  var i

  options = options || {}

  function dflt(opt, value) {
    if(opt in options) {
      return options[opt]
    }
    return value
  }

  this.size         = dflt('size', 12.0)
  this.color        = dflt('color', [1, 0, 0, 1]).slice()
  this.borderSize   = dflt('borderSize', 1)
  this.borderColor  = dflt('borderColor', [0, 0, 0, 1]).slice()

  //Update point data
  var data          = options.positions
  var packed        = pool.mallocFloat32(data.length)
  var packedId      = pool.mallocInt32(data.length >>> 1)
  packed.set(data)
  this.points       = data

  var min = 0
  var max = 10
  this.bounds = [min, min, max, max]
  for(i = 0; i < data.length >>> 1; i++) {
    packedId[i] = i
  }
  for(i = 0; i < data.length; i++) {
    packed[i] = (packed[i] - min) / (max - min)
  }

  this.offsetBuffer.update(packed)
  this.pickBuffer.update(packedId)
  pool.free(packedId)
  pool.free(packed)

  this.pointCount = data.length >>> 1
  this.pickOffset = 0
}

function count(points, dataBox) {
  var visiblePointCountEstimate = 0
  var length = points.length >>> 1
  var i
  for(i = 0; i < length; i++) {
    var x = points[i * 2]
    var y = points[i * 2 + 1]
    if(x >= dataBox[0] && x <= dataBox[2] && y >= dataBox[1] && y <= dataBox[3])
      visiblePointCountEstimate++
  }
  return visiblePointCountEstimate
}

proto.unifiedDraw = (function() {
  var MATRIX = [1, 0, 0,
                0, 1, 0,
                0, 0, 1]
  var PICK_VEC4 = [0, 0, 0, 0]
return function(pickOffset) {

  var pick = pickOffset !== void(0)

  var shader        = pick ? this.pickShader : this.shader
  var gl            = this.plot.gl
  var dataBox       = this.plot.dataBox

  if(this.pointCount === 0) {
    return pickOffset
  }

  var boundX  = this.bounds[2] - this.bounds[0]
  var boundY  = this.bounds[3] - this.bounds[1]
  var dataX   = dataBox[2] - dataBox[0]
  var dataY   = dataBox[3] - dataBox[1]

  var visiblePointCountEstimate = count(this.points, dataBox)
  var basicPointSize =  this.plot.pickPixelRatio * Math.max(0.1, Math.min(30, 30 / Math.pow(visiblePointCountEstimate, 0.33333)))

  MATRIX[0] = 2.0 * boundX / dataX
  MATRIX[4] = 2.0 * boundY / dataY
  MATRIX[6] = 2.0 * (this.bounds[0] - dataBox[0]) / dataX - 1.0
  MATRIX[7] = 2.0 * (this.bounds[1] - dataBox[1]) / dataY - 1.0

  this.offsetBuffer.bind()

  shader.bind()
  shader.attributes.position.pointer()
  shader.uniforms.matrix      = MATRIX
  shader.uniforms.color       = this.color
  shader.uniforms.borderColor = this.borderColor
  shader.uniforms.pointCloud = shader.uniforms.pointSize < 5
  shader.uniforms.pointSize = basicPointSize * (shader.uniforms.pointCloud ? 1 : (this.size + this.borderSize) / this.size)
  shader.uniforms.centerFraction = this.borderSize === 0 ? 2.0 : this.size / (this.size + this.borderSize + 1.25)

  if(pick) {

    PICK_VEC4[0] = ( pickOffset        & 0xff)
    PICK_VEC4[1] = ((pickOffset >> 8)  & 0xff)
    PICK_VEC4[2] = ((pickOffset >> 16) & 0xff)
    PICK_VEC4[3] = ((pickOffset >> 24) & 0xff)

    this.pickBuffer.bind()
    shader.attributes.pickId.pointer(gl.UNSIGNED_BYTE)
    shader.uniforms.pickOffset = PICK_VEC4
    this.pickOffset = pickOffset
  }
  
  gl.drawArrays(gl.POINTS, 0, this.pointCount)

  return pickOffset + this.pointCount
}
})()

proto.draw = proto.unifiedDraw
proto.drawPick = proto.unifiedDraw

proto.pick = function(x, y, value) {
  var pickOffset = this.pickOffset
  var pointCount = this.pointCount
  if(value < pickOffset || value >= pickOffset + pointCount) {
    return null
  }
  var pointId = value - pickOffset
  var points = this.points
  return {
    object: this,
    pointId: pointId,
    dataCoord: [points[2 * pointId], points[2 * pointId + 1] ]
  }
}

function createScatter2D(plot, options) {
  var gl = plot.gl
  var buffer = createBuffer(gl)
  var pickBuffer = createBuffer(gl)
  var shader = createShader(gl, SHADERS.pointVertex, SHADERS.pointFragment)
  var pickShader = createShader(gl, SHADERS.pickVertex, SHADERS.pickFragment)

  var result = new Scatter2D(plot, buffer, pickBuffer, shader, pickShader)
  result.update(options)

  //Register with plot
  plot.addObject(result)

  return result
}
