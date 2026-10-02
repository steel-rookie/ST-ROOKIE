"""Validate the layered GLB's shell dimensions, parts, and paint IDs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from render_layered import accessor, images, load_glb


REQUIRED_PARTS = {
    "CHARACTER_head", "CHARACTER_hands", "CHARACTER_feet",
    "CLOTH_jacket_front_left", "CLOTH_jacket_front_right",
    "CLOTH_jacket_back", "CLOTH_pants", "CLOTH_collar_left",
    "CLOTH_collar_right", "CLOTH_zipper_left_tape",
    "CLOTH_zipper_right_tape", "CLOTH_zipper_teeth",
}


def validate(path: Path, source_fbx: Path | None = None):
    document, binary = load_glb(path)
    names = [node["name"] for node in document["nodes"]]
    outfit_only = path.stem == "posukho_outfit_only"
    rebuilt = path.stem == "posukho_reference_rebuilt"
    assert len(names) == len(set(names))
    if outfit_only:
        assert set(names) == {name for name in REQUIRED_PARTS if name.startswith("CLOTH_")}
        assert len(document["materials"]) == 6
        assert all("CHARACTER" not in material["name"] for material in document["materials"])
        assert len(images(document, binary)) == len(document["textures"]) == 2
        assert document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 0
        assert document["materials"][5]["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 1
    elif rebuilt:
        assert {name for name in REQUIRED_PARTS if name.startswith("CLOTH_")}.issubset(names)
        assert {"CHARACTER_hands", "CHARACTER_feet", "REFERENCE_head", "REFERENCE_mouth"}.issubset(names)
        assert "CHARACTER_head" not in names
        assert len(document["materials"]) == 11
        assert len(images(document, binary)) == len(document["textures"]) == 4
        assert document["materials"][7]["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 3
    else:
        assert REQUIRED_PARTS.issubset(names)
        assert len(images(document, binary)) == 3
        assert len(document["textures"]) == 3
        assert [m["name"] for m in document["materials"]][:3] == [
            "ID_00_CHARACTER_PAINT", "ID_01_CLOTH_OUTER_PAINT", "ID_02_CLOTH_LINING_AND_EDGES"
        ]
        assert document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 0
        assert document["materials"][1]["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 1
        assert document["materials"][6]["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 2
    shell_stats = {}
    for node in document["nodes"]:
        name = node["name"]
        mesh = document["meshes"][node["mesh"]]
        primitives = mesh["primitives"]
        for primitive in primitives:
            assert primitive["material"] < len(document["materials"])
            attrs = primitive["attributes"]
            pos = accessor(document, binary, attrs["POSITION"])
            indices = accessor(document, binary, primitive["indices"])
            assert len(indices) % 3 == 0 and int(indices.max()) < len(pos)
            if "TEXCOORD_0" in attrs:
                uv = accessor(document, binary, attrs["TEXCOORD_0"])
                assert len(uv) == len(pos) and np.all((uv >= 0) & (uv <= 1))
            if "baseColorTexture" in document["materials"][primitive["material"]]["pbrMetallicRoughness"]:
                assert "TEXCOORD_0" in attrs
        if name.startswith("CLOTH_jacket") or name == "CLOTH_pants":
            assert len(primitives) == 3
            outer = accessor(document, binary, primitives[0]["attributes"]["POSITION"])
            inner = accessor(document, binary, primitives[1]["attributes"]["POSITION"])
            difference = np.linalg.norm(outer - inner, axis=1)
            assert np.max(np.abs(difference - 0.002)) < 1e-5, (name, float(difference.min()), float(difference.max()))
            shell_stats[name] = (len(outer), float(np.median(difference)))
    manifest_path = path.with_name(path.stem + "_manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["shell_pull_m"] == manifest["shell_wall_thickness_m"] == 0.002
    assert all(part["nonmanifold_edges"] == 0 for key, part in manifest["parts"].items()
               if key.startswith("CLOTH_jacket") or key == "CLOTH_pants")
    if source_fbx is not None and outfit_only:
        from scipy.spatial import cKDTree
        from build_uniform_v2 import load_mesh_and_uv

        source_vertices, _, _, _ = load_mesh_and_uv(source_fbx)
        source_tree = cKDTree(source_vertices)
        for node in document["nodes"]:
            if not (node["name"].startswith("CLOTH_jacket") or node["name"] == "CLOTH_pants"):
                continue
            inner_primitive = document["meshes"][node["mesh"]]["primitives"][1]
            gltf_pos = accessor(document, binary, inner_primitive["attributes"]["POSITION"])
            source_coords = np.column_stack((gltf_pos[:, 0], -gltf_pos[:, 2], gltf_pos[:, 1]))
            nearest_distance, _ = source_tree.query(source_coords)
            assert float(nearest_distance.max()) < 1e-6, (node["name"], float(nearest_distance.max()))
        print("  Inner clothing surface aligns with original FBX vertices")
    print(path.name, "valid", len(names), "nodes", len(document["materials"]), "materials")
    for name, (count, thickness) in shell_stats.items():
        print(" ", name, count, "outer vertices", f"{thickness * 100:.3f} cm wall")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("--fbx", type=Path)
    args = parser.parse_args()
    validate(args.glb, args.fbx)


if __name__ == "__main__":
    main()
