"""Inspect a binary FBX source and extract its embedded image data.

This is a small read-only inspector for the supplied Tripo character model.
It does not depend on Blender or alter the source FBX.
"""

from __future__ import annotations

import argparse
import struct
import zlib
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image


def properties(data: bytes, offset: int, count: int):
    values = []
    for _ in range(count):
        kind = chr(data[offset])
        offset += 1
        if kind in "YCI FDL".replace(" ", ""):
            fmt = {"Y": "h", "C": "?", "I": "i", "F": "f", "D": "d", "L": "q"}[kind]
            value = struct.unpack_from("<" + fmt, data, offset)[0]
            offset += struct.calcsize(fmt)
        elif kind in "SR":
            length = struct.unpack_from("<I", data, offset)[0]
            offset += 4
            value = data[offset : offset + length]
            offset += length
            if kind == "S":
                value = value.decode("utf-8", errors="replace")
        elif kind in "fdlibc":
            length, encoding, compressed_length = struct.unpack_from("<III", data, offset)
            offset += 12
            payload = data[offset : offset + compressed_length]
            offset += compressed_length
            value = (kind, length, zlib.decompress(payload) if encoding else payload)
        else:
            raise ValueError(f"Unknown FBX property {kind!r} at {offset - 1}")
        values.append(value)
    return values, offset


def nodes(data: bytes, start: int, end: int, version: int):
    offset = start
    header_size = 25 if version >= 7500 else 13
    header_format = "<QQQB" if version >= 7500 else "<IIIB"
    while offset + header_size <= end:
        node_end, count, length, name_length = struct.unpack_from(header_format, data, offset)
        if node_end == 0:
            break
        name = data[offset + header_size : offset + header_size + name_length].decode("utf-8", "replace")
        props, child_start = properties(data, offset + header_size + name_length, count)
        if child_start != offset + header_size + name_length + length:
            raise ValueError(f"Property length mismatch for {name}")
        children = list(nodes(data, child_start, node_end, version))
        yield name, props, children
        offset = node_end


def compact(value):
    if isinstance(value, bytes):
        return f"<bytes {len(value)}>"
    if isinstance(value, tuple):
        return f"<array {value[0]} {value[1]}>"
    if isinstance(value, str):
        return value.replace("\x00\x01", "::")[:120]
    return value


def walk(nodes_list, depth=0):
    for name, props, children in nodes_list:
        if depth <= 2 and name in {
            "Objects", "Geometry", "Model", "Material", "Texture", "Video",
            "Connections", "GlobalSettings", "Properties70", "P", "Vertices",
            "PolygonVertexIndex", "LayerElementUV", "Content", "FileName",
        }:
            print("  " * depth + name, [compact(v) for v in props[:6]])
        yield name, props, children
        yield from walk(children, depth + 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fbx", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    data = args.fbx.read_bytes()
    version = struct.unpack_from("<I", data, 23)[0]
    print("FBX version", version, "bytes", len(data))
    tree = list(nodes(data, 27, len(data), version))
    counts = Counter(name for name, _, _ in walk(tree))
    print("Node counts", counts.most_common(25))
    vertices_node = next((p for name, p, _ in walk(tree) if name == "Vertices"), None)
    if vertices_node:
        verts = np.frombuffer(vertices_node[0][2], dtype="<f8").reshape(-1, 3)
        print("Vertices", len(verts), "minimum", verts.min(axis=0), "maximum", verts.max(axis=0))
        if args.preview:
            import matplotlib.pyplot as plt

            sample = verts[:: max(1, len(verts) // 45000)]
            fig, axes = plt.subplots(1, 3, figsize=(15, 6), facecolor="#eeeeee")
            for ax, (horizontal, vertical), title in zip(
                axes, [(0, 1), (2, 1), (0, 2)], ["X/Y", "Z/Y", "X/Z"]
            ):
                ax.scatter(sample[:, horizontal], sample[:, vertical], s=0.08, c=sample[:, 2], cmap="viridis")
                ax.set_aspect("equal")
                ax.set_title(title)
            fig.tight_layout()
            args.output.mkdir(parents=True, exist_ok=True)
            fig.savefig(args.output / "source_views.png", dpi=160)
            plt.close(fig)
    for name, props, children in walk(tree):
        if name != "Video":
            continue
        print("Video children", [(n, [compact(v) for v in p[:2]]) for n, p, _ in children])
        image_data = next((p[0] for n, p, _ in children if n == "Content" and p), None)
        if not image_data:
            continue
        print("Embedded video", [compact(v) for v in props[:3]], len(image_data), image_data[:16])
        try:
            from io import BytesIO
            image = Image.open(BytesIO(image_data))
            image.load()
            args.output.mkdir(parents=True, exist_ok=True)
            output = args.output / f"texture_{len(list(args.output.glob('texture_*.png')))}.png"
            image.save(output)
            print("Saved", output, image.size, image.mode)
        except Exception as exc:
            print("Image decode failed:", exc)


if __name__ == "__main__":
    main()
