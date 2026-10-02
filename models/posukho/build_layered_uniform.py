"""Build a hollow, separately paintable jacket and pants for Posukho.

All measurements are in model units (the supplied one-unit-tall FBX uses
UnitScaleFactor=100, so 0.002 model units represents 0.2 cm). The output
contains only clothing; the source character is left untouched. Each clothing
part has an outer surface, reversed inner surface, and boundary wall.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from build_uniform_v2 import (
    append_raw,
    front_surface_sampler,
    load_mesh_and_uv,
    render_preview,
    stylize_proportions,
    texture_png,
)
from mesh_utils import GlbBuilder, vertex_normals


PULL = 0.002
WALL = 0.002
WAIST = 0.205
NECK = 0.385
FOOT_TOP = 0.062
WRIST_X = 0.175
ZIPPER_GAP = 0.004


def to_gltf(vector):
    return np.column_stack((vector[:, 0], vector[:, 2], -vector[:, 1])).astype("<f4")


def part_masks(source_vertices, faces):
    center = source_vertices[faces].mean(axis=1)
    x, y, z = center.T
    head = z >= NECK
    feet = z < FOOT_TOP
    hands = (z >= FOOT_TOP) & (z < WAIST) & (np.abs(x) >= WRIST_X)
    jacket = (z >= WAIST) & (z < NECK)
    pants = (z >= FOOT_TOP) & (z < WAIST) & ~hands
    front = y < 0
    gap = np.abs(x) < ZIPPER_GAP / 2
    masks = {
        "CHARACTER_head": head,
        "CHARACTER_hands": hands,
        "CHARACTER_feet": feet,
        "CLOTH_jacket_front_left": jacket & front & (x < -ZIPPER_GAP / 2),
        "CLOTH_jacket_front_right": jacket & front & (x > ZIPPER_GAP / 2),
        "CLOTH_jacket_back": jacket & ~front,
        "CLOTH_pants": pants,
    }
    excluded = ~(np.logical_or.reduce(list(masks.values())))
    print("Removed interior/zipper faces:", int(np.sum(excluded)), "of", len(faces))
    return masks


def unique_corner_data(vertices, faces, uv, uv_faces, normals):
    pairs = np.column_stack((faces.ravel(), uv_faces.ravel()))
    unique, inverse = np.unique(pairs, axis=0, return_inverse=True)
    pos = vertices[unique[:, 0]]
    norm = normals[unique[:, 0]]
    tex = uv[unique[:, 1]].copy()
    tex[:, 1] = 1.0 - tex[:, 1]
    return pos, norm, tex.astype("<f4"), inverse.reshape(-1, 3).astype("<u4")


def boundary_edges(faces):
    oriented = np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]))
    key = np.sort(oriented, axis=1)
    _, indices, counts = np.unique(key, axis=0, return_index=True, return_counts=True)
    return oriented[indices[counts == 1]], int(np.sum(counts > 2))


def glb_primitive(builder, position, normal, indices, material, texcoord=None):
    attributes = {"POSITION": builder.accessor(to_gltf(position), 5126, "VEC3", 34962),
                  "NORMAL": builder.accessor(to_gltf(normal), 5126, "VEC3", 34962)}
    if texcoord is not None:
        attributes["TEXCOORD_0"] = builder.accessor(texcoord, 5126, "VEC2", 34962)
    return {"attributes": attributes,
            "indices": builder.accessor(indices.ravel().astype("<u4"), 5125, "SCALAR", 34963),
            "material": material}


def character_mesh(builder, vertices, faces, uv, uv_faces, normals):
    pos, norm, tex, indices = unique_corner_data(vertices, faces, uv, uv_faces, normals)
    return {"primitives": [glb_primitive(builder, pos, norm, indices, 0, tex)]}


def shell_mesh(builder, vertices, faces, uv, uv_faces, normals, outer_material=1, lining_material=2):
    outer_pos, outer_norm, tex, outer_indices = unique_corner_data(vertices, faces, uv, uv_faces, normals)
    outer_pos = outer_pos + outer_norm * PULL
    inner_pos = outer_pos - outer_norm * WALL
    outer = glb_primitive(builder, outer_pos, outer_norm, outer_indices, outer_material, tex)
    inner = glb_primitive(builder, inner_pos, -outer_norm, outer_indices[:, [0, 2, 1]], lining_material)

    used, local = np.unique(faces, return_inverse=True)
    local_faces = local.reshape(-1, 3).astype(np.uint32)
    boundary, nonmanifold = boundary_edges(local_faces)
    base = vertices[used]
    normal = normals[used]
    outer_boundary = base + normal * PULL
    inner_boundary = outer_boundary - normal * WALL
    wall_pos = np.vstack((outer_boundary, inner_boundary))
    count = len(used)
    a, b = boundary[:, 0], boundary[:, 1]
    wall_faces = np.column_stack((a, b + count, b)).astype(np.uint32)
    wall_faces_2 = np.column_stack((a, a + count, b + count)).astype(np.uint32)
    wall_faces = np.vstack((wall_faces, wall_faces_2))
    wall_norm = vertex_normals(wall_pos, wall_faces)
    rim = glb_primitive(builder, wall_pos, wall_norm, wall_faces, lining_material)
    info = {"surface_triangles": int(len(faces)), "boundary_edges": int(len(boundary)),
            "nonmanifold_edges": nonmanifold, "pull_m": PULL, "wall_m": WALL}
    return {"primitives": [outer, inner, rim]}, info


def add_primitive_node(builder, meshes, nodes, name, positions, faces, material):
    normals = vertex_normals(positions, faces)
    primitive = glb_primitive(builder, positions, normals, faces, material)
    nodes.append({"name": name, "mesh": len(meshes)})
    meshes.append({"name": name, "primitives": [primitive]})


def collar_parts(neck_height):
    """Two folded lapels at the front opening, each with a 2 mm edge."""
    styled = neck_height > 0.45
    sx, sy, sz = (1.15, 1.10, 1.32) if styled else (1.0, 1.0, 1.0)
    parts = []
    for sign, name in ((-1, "CLOTH_collar_left"), (1, "CLOTH_collar_right")):
        outline = np.array([
            (sign * 0.018 * sx, -0.081 * sy, neck_height - 0.038 * sz),
            (sign * 0.067 * sx, -0.075 * sy, neck_height - 0.033 * sz),
            (sign * 0.074 * sx, -0.080 * sy, neck_height - 0.002 * sz),
            (sign * 0.023 * sx, -0.093 * sy, neck_height + 0.005 * sz),
        ], dtype=np.float32)
        inner = outline.copy()
        inner[:, 1] += 0.002
        positions = np.vstack((outline, inner))
        faces = np.array([
            (0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6),
            (0, 4, 5), (0, 5, 1), (1, 5, 6), (1, 6, 2),
            (2, 6, 7), (2, 7, 3), (3, 7, 4), (3, 4, 0),
        ], dtype=np.uint32)
        parts.append((name, positions, faces))
    return parts


def curved_strip(sample, x_left, x_right, z_bottom, z_top, columns=4, rows=20):
    xs = np.linspace(x_left, x_right, columns + 1)
    zs = np.linspace(z_bottom, z_top, rows + 1)
    positions = []
    for z in zs:
        for x in xs:
            positions.append((x, sample(x, z) - 0.0045, z))
    faces = []
    for row in range(rows):
        for col in range(columns):
            a = row * (columns + 1) + col
            b, c, d = a + 1, a + columns + 1, a + columns + 2
            faces.extend(((a, c, b), (b, c, d)))
    return np.array(positions, np.float32), np.array(faces, np.uint32)


def zipper_parts(vertices, waist_height, neck_height):
    sample = front_surface_sampler(vertices, waist_height + 0.01, neck_height - 0.02)
    bottom = waist_height + 0.018
    top = neck_height - 0.029
    parts = []
    for name, a, b in (("CLOTH_zipper_left_tape", -0.013, -0.002),
                       ("CLOTH_zipper_right_tape", 0.002, 0.013)):
        pos, faces = curved_strip(sample, a, b, bottom, top)
        parts.append((name, pos, faces, 3))
    # Small separated teeth make the center opening legible from the front.
    tooth_positions, tooth_faces = [], []
    for z in np.arange(bottom + 0.004, top - 0.002, 0.008):
        pos, faces = curved_strip(sample, -0.003, 0.003, z, z + 0.0025, columns=1, rows=1)
        tooth_faces.append(faces + len(tooth_positions))
        tooth_positions.extend(pos)
    if tooth_faces:
        parts.append(("CLOTH_zipper_teeth", np.array(tooth_positions, np.float32),
                      np.vstack(tooth_faces).astype(np.uint32), 4))
    return parts


def reference_head_front(x, z):
    radial = (x / 0.335) ** 2 + ((z - 0.680) / 0.275) ** 2
    return -0.260 * np.sqrt(max(0.001, 1.0 - radial))


def ellipsoid(center, radii, rings=28, sectors=48):
    points, triangles = [], []
    for row in range(rings + 1):
        theta = np.pi * row / rings
        for col in range(sectors + 1):
            phi = 2 * np.pi * col / sectors
            points.append((center[0] + radii[0] * np.sin(theta) * np.cos(phi),
                           center[1] + radii[1] * np.sin(theta) * np.sin(phi),
                           center[2] + radii[2] * np.cos(theta)))
    for row in range(rings):
        for col in range(sectors):
            a = row * (sectors + 1) + col
            b, c, d = a + 1, a + sectors + 1, a + sectors + 2
            triangles.extend(((a, c, b), (b, c, d)))
    return np.array(points, np.float32), np.array(triangles, np.uint32)


def reference_head_texture(path, width=1024, height=512):
    u = (np.arange(width, dtype=np.float32)[None, :] + 0.5) / width
    v = (np.arange(height, dtype=np.float32)[:, None] + 0.5) / height
    phi, theta = 2 * np.pi * u, np.pi * v
    x = 0.335 * np.sin(theta) * np.cos(phi)
    z = 0.680 + 0.275 * np.cos(theta)
    front = np.clip((-np.sin(phi) - 0.12) / 0.50, 0, 1)
    distance = ((np.abs(x) - 0.205) / 0.072) ** 2 + ((z - 0.615) / 0.105) ** 2
    blush = 0.32 * np.exp(-0.5 * distance) * front
    base = np.array([249.0, 249.0, 246.0], np.float32)
    rose = np.array([238.0, 152.0, 166.0], np.float32)
    rgb = (base[None, None, :] * (1 - blush[:, :, None]) +
           rose[None, None, :] * blush[:, :, None]).astype(np.uint8)
    Image.fromarray(rgb).save(path, optimize=True)


def mouth_tube(segments=32, sides=8):
    points, faces = [], []
    for row in range(segments + 1):
        x = -0.035 + 0.070 * row / segments
        z = 0.663 - 0.011 * (1.0 - ((abs(x) - 0.0175) / 0.0175) ** 2)
        y = reference_head_front(x, z) - 0.008
        for side in range(sides):
            angle = 2 * np.pi * side / sides
            points.append((x, y + 0.0027 * np.cos(angle), z + 0.0027 * np.sin(angle)))
    for row in range(segments):
        for side in range(sides):
            a = row * sides + side
            b = row * sides + (side + 1) % sides
            c, d = a + sides, b + sides
            faces.extend(((a, c, b), (b, c, d)))
    return np.array(points, np.float32), np.array(faces, np.uint32)


def add_rebuilt_head(builder, meshes, nodes, stats):
    head_positions, head_triangles = ellipsoid((0, 0, 0.680), (0.335, 0.260, 0.275), 56, 96)
    head_uv = np.array([(col / 96, row / 56) for row in range(57) for col in range(97)], np.float32)
    head_normal = vertex_normals(head_positions, head_triangles)
    head_primitive = glb_primitive(builder, head_positions, head_normal, head_triangles, 7, head_uv)
    nodes.append({"name": "REFERENCE_head", "mesh": len(meshes)})
    meshes.append({"name": "REFERENCE_head", "primitives": [head_primitive]})
    stats["REFERENCE_head"] = {"triangles": int(len(head_triangles)), "material_id": 7}
    parts = []
    for sign, side in ((-1, "left"), (1, "right")):
        parts.append((f"REFERENCE_ear_{side}", *ellipsoid((sign * 0.250, -0.005, 0.923), (0.074, 0.050, 0.080)), 10))
        parts.append((f"REFERENCE_inner_ear_{side}", *ellipsoid((sign * 0.250, -0.052, 0.928), (0.050, 0.012, 0.055)), 8))
        parts.append((f"REFERENCE_eye_{side}", *ellipsoid((sign * 0.091, reference_head_front(sign * 0.091, 0.716) - 0.006, 0.716), (0.011, 0.007, 0.013), 12, 24), 9))
    parts.append(("REFERENCE_nose", *ellipsoid((0, reference_head_front(0, 0.687) - 0.008, 0.687), (0.010, 0.006, 0.008), 12, 24), 9))
    parts.append(("REFERENCE_mouth", *mouth_tube(), 9))
    for name, positions, triangles, material in parts:
        add_primitive_node(builder, meshes, nodes, name, positions, triangles, material)
        stats[name] = {"triangles": int(len(triangles)), "material_id": material}


def build(path, output, styled, outfit_only=False, reference_face=False, rebuilt_face=False):
    source_vertices, faces, uv, uv_faces = load_mesh_and_uv(path)
    vertices = stylize_proportions(source_vertices) if styled else source_vertices
    normals = vertex_normals(vertices, faces)
    masks = part_masks(source_vertices, faces)
    color_texture = output / ("posukho_reference_character_paint.png" if reference_face else "posukho_character_paint.png")
    cloth_texture = output / "posukho_cloth_paint.png"
    pants_texture = output / "posukho_pants_paint.png"
    head_texture = output / "posukho_reference_head_paint.png"
    if not styled:
        if not outfit_only:
            texture_png(source_vertices, faces, uv, uv_faces, 2048, color_texture, mode=3 if reference_face else 1)
        texture_png(source_vertices, faces, uv, uv_faces, 2048, cloth_texture, mode=2)
        pants_texture.write_bytes(cloth_texture.read_bytes())
    if rebuilt_face:
        reference_head_texture(head_texture)

    builder = GlbBuilder()
    nodes_list, meshes, stats = [], [], {}
    for name, mask in masks.items():
        if (outfit_only and name.startswith("CHARACTER_")) or (rebuilt_face and name == "CHARACTER_head"):
            continue
        selected = faces[mask]
        selected_uv = uv_faces[mask]
        if not len(selected):
            continue
        if name.startswith("CHARACTER_"):
            mesh = character_mesh(builder, vertices, selected, uv, selected_uv, normals)
            stats[name] = {"triangles": int(len(selected)), "material_id": 0}
        else:
            outer_material = (5 if name == "CLOTH_pants" else 0) if outfit_only else (6 if name == "CLOTH_pants" else 1)
            lining_material = 1 if outfit_only else 2
            mesh, info = shell_mesh(builder, vertices, selected, uv, selected_uv, normals,
                                    outer_material, lining_material)
            stats[name] = {**info, "material_ids": [outer_material, lining_material]}
        nodes_list.append({"name": name, "mesh": len(meshes)})
        meshes.append({"name": name, **mesh})

    if rebuilt_face:
        add_rebuilt_head(builder, meshes, nodes_list, stats)

    neck_height = NECK * 1.32 if styled else NECK
    waist_height = WAIST * 1.32 if styled else WAIST
    for name, pos, tri in collar_parts(neck_height):
        collar_material = 4 if outfit_only else 5
        add_primitive_node(builder, meshes, nodes_list, name, pos, tri, collar_material)
        stats[name] = {"triangles": int(len(tri)), "material_id": collar_material}
    for name, pos, tri, material in zipper_parts(vertices, waist_height, neck_height):
        material = material - 1 if outfit_only else material
        add_primitive_node(builder, meshes, nodes_list, name, pos, tri, material)
        stats[name] = {"triangles": int(len(tri)), "material_id": material}

    image_paths = ((cloth_texture, pants_texture) if outfit_only else
                   (color_texture, cloth_texture, pants_texture, head_texture) if rebuilt_face else
                   (color_texture, cloth_texture, pants_texture))
    image_views = [append_raw(builder, p.read_bytes()) for p in image_paths]
    combined_materials = [
        {"name": "ID_00_CHARACTER_PAINT", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.9}, "doubleSided": True},
        {"name": "ID_01_CLOTH_OUTER_PAINT", "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}, "metallicFactor": 0, "roughnessFactor": 0.83}, "doubleSided": True},
        {"name": "ID_02_CLOTH_LINING_AND_EDGES", "pbrMetallicRoughness": {"baseColorFactor": [0.035, 0.065, 0.12, 1], "metallicFactor": 0, "roughnessFactor": 0.88}, "doubleSided": True},
        {"name": "ID_03_ZIPPER_TAPE", "pbrMetallicRoughness": {"baseColorFactor": [0.03, 0.08, 0.17, 1], "metallicFactor": 0, "roughnessFactor": 0.8}, "doubleSided": True},
        {"name": "ID_04_ZIPPER_METAL", "pbrMetallicRoughness": {"baseColorFactor": [0.68, 0.75, 0.78, 1], "metallicFactor": 0.65, "roughnessFactor": 0.3}, "doubleSided": True},
        {"name": "ID_05_COLLAR_ORANGE", "pbrMetallicRoughness": {"baseColorFactor": [0.93, 0.29, 0.06, 1], "metallicFactor": 0, "roughnessFactor": 0.82}, "doubleSided": True},
        {"name": "ID_06_CLOTH_PANTS_PAINT", "pbrMetallicRoughness": {"baseColorTexture": {"index": 2}, "metallicFactor": 0, "roughnessFactor": 0.86}, "doubleSided": True},
    ]
    if rebuilt_face:
        combined_materials.append({"name": "REFERENCE_FUR", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 3}, "metallicFactor": 0, "roughnessFactor": 0.95},
            "doubleSided": True})
        for material_name, rgba in (
            ("REFERENCE_EAR_CYAN", [0.53, 0.87, 0.92, 1]),
            ("REFERENCE_FACE_CHARCOAL", [0.11, 0.12, 0.12, 1]),
            ("REFERENCE_EAR_FUR", [0.977, 0.977, 0.965, 1]),
        ):
            combined_materials.append({"name": material_name, "pbrMetallicRoughness": {
                "baseColorFactor": rgba, "metallicFactor": 0, "roughnessFactor": 0.95}, "doubleSided": True})
    if outfit_only:
        materials = [dict(m) for m in combined_materials[1:]]
        for material in materials:
            color_texture_info = material["pbrMetallicRoughness"].get("baseColorTexture")
            if color_texture_info is not None:
                color_texture_info = dict(color_texture_info)
                color_texture_info["index"] -= 1
                material["pbrMetallicRoughness"] = dict(material["pbrMetallicRoughness"])
                material["pbrMetallicRoughness"]["baseColorTexture"] = color_texture_info
        for i, material in enumerate(materials):
            material["name"] = f"OUTFIT_ID_{i:02d}_" + material["name"].split("_", 2)[-1]
    else:
        materials = combined_materials
    document = {
        "asset": {"version": "2.0", "generator": "ST-ROOKIE layered uniform builder"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes_list)))}],
        "nodes": nodes_list, "meshes": meshes, "materials": materials,
        "images": [{"bufferView": v, "mimeType": "image/png"} for v in image_views],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "textures": [{"sampler": 0, "source": i} for i in range(len(image_views))],
    }
    filename = ("posukho_outfit_only.glb" if outfit_only else
                "posukho_reference_rebuilt.glb" if rebuilt_face else
                "posukho_reference_uniform.glb" if reference_face else
                ("posukho_layered_styled.glb" if styled else "posukho_layered_original.glb"))
    glb = output / filename
    builder.finish(document, glb)
    manifest = {
        "source": path.name, "variant": "outfit_only" if outfit_only else ("reference_rebuilt" if rebuilt_face else ("reference_face" if reference_face else ("styled" if styled else "original_proportions"))),
        "model_unit": "metre", "shell_pull_m": PULL, "shell_wall_thickness_m": WALL,
        "waist_cut_source_z_m": WAIST, "zipper_gap_m": ZIPPER_GAP,
        "jacket_texture": cloth_texture.name,
        "pants_texture": pants_texture.name,
        "material_ids": {str(i): material["name"] for i, material in enumerate(materials)},
        "parts": stats,
    }
    if not outfit_only:
        manifest["character_texture"] = color_texture.name
    if rebuilt_face:
        manifest["head_texture"] = head_texture.name
    (output / (glb.stem + "_manifest.json")).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(glb.name, glb.stat().st_size, "bytes", len(meshes), "meshes")
    return glb, masks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fbx", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    build(args.fbx, args.output, styled=False, outfit_only=True)
    build(args.fbx, args.output, styled=False, reference_face=True, rebuilt_face=True)


if __name__ == "__main__":
    main()
