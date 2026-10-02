"""Small mesh and GLB helpers for the Posukho uniform generator."""

import json
import struct

import numpy as np


def vertex_normals(vertices, faces):
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    cross = np.cross(b - a, c - a)
    normals = np.zeros_like(vertices)
    for column in range(3):
        np.add.at(normals, faces[:, column], cross)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    center = np.array([0.0, 0.0, 0.51], dtype=np.float32)
    if np.median(np.sum(normals * (vertices - center), axis=1)) < 0:
        normals *= -1
    return normals


class GlbBuilder:
    def __init__(self):
        self.binary = bytearray()
        self.views = []
        self.accessors = []

    def accessor(self, array, component_type, gltf_type, target=None):
        array = np.ascontiguousarray(array)
        while len(self.binary) % 4:
            self.binary.append(0)
        offset = len(self.binary)
        self.binary.extend(array.tobytes())
        view = {"buffer": 0, "byteOffset": offset, "byteLength": array.nbytes}
        if target:
            view["target"] = target
        self.views.append(view)
        accessor = {"bufferView": len(self.views) - 1, "componentType": component_type,
                    "count": len(array), "type": gltf_type}
        if gltf_type == "VEC3":
            accessor["min"] = array.min(axis=0).tolist()
            accessor["max"] = array.max(axis=0).tolist()
        self.accessors.append(accessor)
        return len(self.accessors) - 1

    def finish(self, document, path):
        document["bufferViews"] = self.views
        document["accessors"] = self.accessors
        while len(self.binary) % 4:
            self.binary.append(0)
        document["buffers"] = [{"byteLength": len(self.binary)}]
        json_bytes = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        json_bytes += b" " * ((-len(json_bytes)) % 4)
        size = 12 + 8 + len(json_bytes) + 8 + len(self.binary)
        with path.open("wb") as out:
            out.write(struct.pack("<4sII", b"glTF", 2, size))
            out.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
            out.write(json_bytes)
            out.write(struct.pack("<I4s", len(self.binary), b"BIN\x00"))
            out.write(self.binary)
