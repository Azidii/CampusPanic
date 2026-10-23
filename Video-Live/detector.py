"""Runtime for the supplied single-class YOLO11 TFLite export. No training."""
import json
import time
import zipfile

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter


def letterbox(frame, size=640):
    h, w = frame.shape[:2]
    ratio = min(size / h, size / w)
    nw, nh = round(w * ratio), round(h * ratio)
    left, top = (size - nw) // 2, (size - nh) // 2
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
    padded = cv2.copyMakeBorder(resized, top, size - nh - top,
                                left, size - nw - left, cv2.BORDER_CONSTANT,
                                value=(114, 114, 114))
    return padded, ratio, left, top


def decode(output, original_shape, ratio, left, top, threshold, iou=0.45):
    """Normalized xywh + gun score, [1,5,8400], with external NMS."""
    rows = output[0].T
    rows = rows[np.isfinite(rows).all(axis=1) & (rows[:, 4] >= threshold)]
    if not len(rows):
        return []
    # Bound NMS work if a damaged/incorrect input produces many candidates.
    rows = rows[np.argsort(rows[:, 4])[::-1][:3000]]
    xywh = rows[:, :4] * 640.0
    boxes = np.column_stack(((xywh[:, 0] - xywh[:, 2] / 2 - left) / ratio,
                             (xywh[:, 1] - xywh[:, 3] / 2 - top) / ratio,
                             xywh[:, 2] / ratio, xywh[:, 3] / ratio))
    selected = cv2.dnn.NMSBoxes(boxes.tolist(), rows[:, 4].tolist(),
                                threshold, iou, top_k=100)
    h, w = original_shape[:2]
    detections = []
    for idx in np.asarray(selected).reshape(-1):
        x, y, bw, bh = boxes[idx]
        x1, x2 = np.clip([x, x + bw], 0, w - 1)
        y1, y2 = np.clip([y, y + bh], 0, h - 1)
        if x2 <= x1 or y2 <= y1:
            continue
        detections.append({'label': 'gun', 'confidence': float(rows[idx, 4]),
                           'box': [round(float(v)) for v in (x1, y1, x2, y2)]})
    return detections


class Detector:
    def __init__(self, model_path, threshold=0.5, threads=4):
        self.threshold = threshold
        with zipfile.ZipFile(model_path) as archive:
            self.metadata = json.loads(archive.read('metadata.json'))
        if self.metadata.get('names') != {'0': 'gun'} or self.metadata.get('end2end'):
            raise ValueError('Expected the supplied single-class gun export without embedded NMS.')
        self.interpreter = Interpreter(model_path=str(model_path), num_threads=threads)
        self.interpreter.allocate_tensors()
        self.input = self.interpreter.get_input_details()[0]
        self.output = self.interpreter.get_output_details()[0]
        if (self.input['shape'].tolist() != [1, 3, 640, 640]
                or self.input['dtype'] != np.float32
                or self.output['shape'].tolist() != [1, 5, 8400]
                or self.output['dtype'] != np.float32):
            raise ValueError('Unexpected tensors; this runner targets the inspected gun_model.tflite.')

    def predict(self, frame):
        start = time.perf_counter()
        padded, ratio, left, top = letterbox(frame)
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
        tensor = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
        self.interpreter.set_tensor(self.input['index'], tensor)
        inference_start = time.perf_counter()
        self.interpreter.invoke()
        inference_ms = (time.perf_counter() - inference_start) * 1000
        output = self.interpreter.get_tensor(self.output['index'])
        detections = decode(output, frame.shape, ratio, left, top, self.threshold)
        return detections, inference_ms, (time.perf_counter() - start) * 1000


def annotate(frame, detections, inference_ms):
    image = frame.copy()
    for detection in detections:
        x1, y1, x2, y2 = detection['box']
        color = (60, 60, 245)
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        label = f"gun {detection['confidence'] * 100:.1f}%"
        cv2.putText(image, label, (x1, max(22, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
    cv2.putText(image, f'Laptop inference: {inference_ms:.0f} ms', (12, image.shape[0] - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1)
    return image
