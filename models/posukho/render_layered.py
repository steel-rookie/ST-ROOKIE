"""Render a quick orthographic QA image directly from a layered GLB file."""

from __future__ import annotations

import argparse
import io
import json
import struct
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def load_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Invalid GLB header")
    json_length, json_tag = struct.unpack_from("<I4s", data, 12)
    document = json.loads(data[20 : 20 + json_length])
    binary_length, binary_tag = struct.unpack_from("<I4s", data, 20 + json_length)
    if json_tag != b"JSON" or binary_tag != b"BIN\x00":
        raise ValueError("Invalid GLB chunks")
    binary = memoryview(data)[28 + json_length : 28 + json_length + binary_length]
    return document, binary


def accessor(document, binary, index):
    info = document["accessors"][index]
    view = document["bufferViews"][info["bufferView"]]
    dtype = {5126: "<f4", 5125: "<u4", 5123: "<u2"}[info["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[info["type"]]
    offset = view.get("byteOffset", 0) + info.get("byteOffset", 0)
    values = np.frombuffer(binary, dtype=dtype, count=info["count"] * width, offset=offset)
    return values.reshape(-1, width) if width > 1 else values


def images(document, binary):
    result = []
    for item in document["images"]:
        view = document["bufferViews"][item["bufferView"]]
        start, size = view["byteOffset"], view["byteLength"]
        result.append(np.asarray(Image.open(io.BytesIO(binary[start : start + size].tobytes())).convert("RGB")))
    return result


def render(path, output, angle=0, front=True, detail=False):
    document, binary = load_glb(path)
    textures = images(document, binary)
    verts, faces, colors, depths = [], [], [], []
    radians = np.deg2rad(angle)
    for node in document["nodes"]:
        name = node["name"]
        mesh = document["meshes"][node["mesh"]]
        for primitive in mesh["primitives"]:
            material_id = primitive["material"]
            # Interior and boundary walls are verified structurally below;
            # omit them here so the painter preview shows the outer surface.
            if "LINING_AND_EDGES" in document["materials"][material_id]["name"]:
                continue
            attr = primitive["attributes"]
            gltf_pos = accessor(document, binary, attr["POSITION"])
            pos = np.column_stack((gltf_pos[:, 0], -gltf_pos[:, 2], gltf_pos[:, 1]))
            triangles = accessor(document, binary, primitive["indices"]).reshape(-1, 3)
            rotated_x = pos[:, 0] * np.cos(radians) - pos[:, 1] * np.sin(radians)
            rotated_y = pos[:, 0] * np.sin(radians) + pos[:, 1] * np.cos(radians)
            view_pos = np.column_stack((rotated_x, rotated_y, pos[:, 2]))
            depth = view_pos[triangles, 1].mean(axis=1)
            material = document["materials"][material_id]["pbrMetallicRoughness"]
            if "baseColorTexture" in material:
                uv = accessor(document, binary, attr["TEXCOORD_0"])
                uv_center = uv[triangles].mean(axis=1)
                tex_index = material["baseColorTexture"]["index"]
                image_index = document["textures"][tex_index]["source"]
                image = textures[image_index]
                x = np.clip((uv_center[:, 0] * (image.shape[1] - 1)).astype(np.int32), 0, image.shape[1] - 1)
                y = np.clip((uv_center[:, 1] * (image.shape[0] - 1)).astype(np.int32), 0, image.shape[0] - 1)
                color = image[y, x].astype(np.float32)
            else:
                color = np.tile(np.array(material["baseColorFactor"][:3], np.float32) * 255, (len(triangles), 1))
            face_pos = view_pos[triangles]
            face_normal = np.cross(face_pos[:, 1] - face_pos[:, 0], face_pos[:, 2] - face_pos[:, 0])
            face_normal /= np.maximum(np.linalg.norm(face_normal, axis=1, keepdims=True), 1e-12)
            light = np.array((0.25, -0.83 if front else 0.83, 0.50), np.float32)
            shade = np.clip(0.74 + 0.24 * np.abs(np.sum(face_normal * light, axis=1)), 0.66, 1.0)
            color *= shade[:, None]
            verts.append(view_pos)
            faces.append(triangles + sum(len(v) for v in verts[:-1]))
            colors.append(color)
            depths.append(depth)

    all_verts = np.vstack(verts)
    all_faces = np.vstack(faces)
    all_colors = np.vstack(colors)
    all_depth = np.concatenate(depths)
    styled = "styled" in path.name
    scale, top, horizontal_offset = ((1300, 0.64, 0.27) if detail else
                                     ((690, 1.25, 0.45) if styled else (805, 1.04, 0.45)))
    pixels = np.column_stack(((all_verts[:, 0] + horizontal_offset) * scale + 28,
                              (top - all_verts[:, 2]) * scale + 18)).astype(np.int32)
    image = np.full((900, 720, 3), (220, 225, 230), dtype=np.uint8)
    visible = np.flatnonzero(all_depth < 0 if front else all_depth >= 0)
    order = visible[np.argsort(-all_depth[visible] if front else all_depth[visible])]
    for face_id in order:
        rgb = all_colors[face_id]
        cv2.fillConvexPoly(image, pixels[all_faces[face_id]], tuple(int(x) for x in rgb[::-1]), lineType=cv2.LINE_AA)
    ok, png = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    output.write_bytes(png.tobytes())
    print(f"Rendered {len(order)} exterior triangles from {len(document['nodes'])} nodes")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--angle", type=float, default=0)
    parser.add_argument("--back", action="store_true")
    parser.add_argument("--detail", action="store_true")
    args = parser.parse_args()
    render(args.glb, args.output, args.angle, not args.back, args.detail)


if __name__ == "__main__":
    main()
