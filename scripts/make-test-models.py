"""Builds two tiny ONNX *test fixtures* that match the RVC ONNX interface.

They are NOT voice models. They exist so automated tests can exercise the real
inference plumbing (tensor names, shapes, dtypes, chunking, overlap-add, F0 path):
  content.onnx : source [1,1,N] -> Conv1d(k=320,s=320) -> [1,T,768]
  voice.onnx   : (phone, phone_lengths, pitch, pitchf, ds, rnd) -> audio [1,1,T*400]
                 = 0.3*sin(cumsum(2*pi*pitchf/40000)) (+0*mean(phone)) -- output pitch follows pitchf.
"""
import sys, numpy as np, onnx
from onnx import helper as h, TensorProto as T, numpy_helper as nh

out = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures'
rng = np.random.default_rng(0)
W = (rng.standard_normal((768, 1, 320)) * 0.01).astype(np.float32)
g = h.make_graph(
    [h.make_node('Conv', ['source', 'W'], ['c'], kernel_shape=[320], strides=[320]),
     h.make_node('Transpose', ['c'], ['feats'], perm=[0, 2, 1])],
    'content', [h.make_tensor_value_info('source', T.FLOAT, [1, 1, 'N'])],
    [h.make_tensor_value_info('feats', T.FLOAT, [1, 'T', 768])], [nh.from_array(W, 'W')])
onnx.save(h.make_model(g, opset_imports=[h.make_opsetid('', 17)], ir_version=8), f'{out}/content.onnx')

c = lambda name, arr: nh.from_array(np.array(arr), name)
nodes = [
    h.make_node('Unsqueeze', ['pitchf', 'ax2'], ['pf3']),                 # [1,T,1]
    h.make_node('Tile', ['pf3', 'rep'], ['pft']),                          # [1,T,400]
    h.make_node('Reshape', ['pft', 'flat'], ['f']),                        # [1,L]
    h.make_node('Mul', ['f', 'k'], ['inc']),
    h.make_node('CumSum', ['inc', 'ax1'], ['ph']),
    h.make_node('Sin', ['ph'], ['s']),
    h.make_node('Mul', ['s', 'amp'], ['a']),
    h.make_node('ReduceMean', ['phone'], ['pm'], keepdims=0),
    h.make_node('Mul', ['pm', 'zero'], ['pz']),
    h.make_node('ReduceMean', ['rnd'], ['rm'], keepdims=0),
    h.make_node('Mul', ['rm', 'zero'], ['rz']),
    h.make_node('Add', ['a', 'pz'], ['a2']), h.make_node('Add', ['a2', 'rz'], ['a3']),
    h.make_node('Unsqueeze', ['a3', 'ax1'], ['audio']),                    # [1,1,L]
]
inits = [c('ax2', np.array([2], np.int64)), c('ax1', np.array([1], np.int64)), c('rep', np.array([1, 1, 400], np.int64)),
         c('flat', np.array([1, -1], np.int64)), c('k', np.float32(2 * np.pi / 40000)), c('amp', np.float32(0.3)), c('zero', np.float32(0))]
inputs = [h.make_tensor_value_info('phone', T.FLOAT, [1, 'T', 768]), h.make_tensor_value_info('phone_lengths', T.INT64, [1]),
          h.make_tensor_value_info('pitch', T.INT64, [1, 'T']), h.make_tensor_value_info('pitchf', T.FLOAT, [1, 'T']),
          h.make_tensor_value_info('ds', T.INT64, [1]), h.make_tensor_value_info('rnd', T.FLOAT, [1, 192, 'T'])]
g = h.make_graph(nodes, 'voice', inputs, [h.make_tensor_value_info('audio', T.FLOAT, [1, 1, 'L'])], inits)
m = h.make_model(g, opset_imports=[h.make_opsetid('', 17)], ir_version=8)
onnx.checker.check_model(m)
onnx.save(m, f'{out}/voice.onnx')
print('fixtures written to', out)

# rmvpe.onnx fixture: mel [1,128,T] -> sigmoid(mel^T @ W) [1,T,360]  (plumbing test only)
Wr = (rng.standard_normal((128, 360)) * 0.05).astype(np.float32)
g = h.make_graph(
    [h.make_node('Transpose', ['input'], ['t'], perm=[0, 2, 1]), h.make_node('MatMul', ['t', 'Wr'], ['m']), h.make_node('Sigmoid', ['m'], ['output'])],
    'rmvpe', [h.make_tensor_value_info('input', T.FLOAT, [1, 128, 'T'])], [h.make_tensor_value_info('output', T.FLOAT, [1, 'T', 360])], [nh.from_array(Wr, 'Wr')])
onnx.save(h.make_model(g, opset_imports=[h.make_opsetid('', 17)], ir_version=8), f'{out}/rmvpe.onnx')
