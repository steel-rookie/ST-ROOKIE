"""Bake a detailed uniform and face texture onto the supplied Tripo bear.

The output GLB is self contained. The matching garment OBJ uses the source
FBX's original Z-up coordinates and the generated PNG texture.
"""

from __future__ import annotations

import argparse
import io
import json
import struct
from pathlib import Path

import cv2
import numpy as np
from numba import njit
from PIL import Image, ImageDraw, ImageFont

from mesh_utils import GlbBuilder, vertex_normals
from inspect_source import nodes


def load_mesh_and_uv(path: Path):
    data = path.read_bytes()
    version = struct.unpack_from("<I", data, 23)[0]
    objects = next(ch for n, _, ch in nodes(data, 27, len(data), version) if n == "Objects")
    geometry = next(ch for n, _, ch in objects if n == "Geometry")
    attrs = {n: p for n, p, _ in geometry}
    vertices = np.frombuffer(attrs["Vertices"][0][2], "<f8").reshape(-1, 3).astype(np.float32)
    indices = np.frombuffer(attrs["PolygonVertexIndex"][0][2], "<i4").copy()
    assert len(indices) % 3 == 0 and np.all(indices[2::3] < 0)
    indices[2::3] = -indices[2::3] - 1
    faces = indices.reshape(-1, 3).astype(np.uint32)
    uv_layer = next(ch for n, _, ch in geometry if n == "LayerElementUV")
    uv_attrs = {n: p for n, p, _ in uv_layer}
    uv = np.frombuffer(uv_attrs["UV"][0][2], "<f8").reshape(-1, 2).astype(np.float32)
    uv_faces = np.frombuffer(uv_attrs["UVIndex"][0][2], "<i4").reshape(-1, 3).astype(np.uint32)
    return vertices, faces, uv, uv_faces


@njit(cache=True)
def smooth(a, b, t):
    u = min(1.0, max(0.0, (t - a) / (b - a)))
    return u * u * (3.0 - 2.0 * u)


@njit(cache=True)
def mix(a, b, t):
    return a * (1.0 - t) + b * t


@njit(cache=True)
def painted_color(x, y, z, mode):
    # Warm cream fur with restrained shading; the reference FBX has no texture.
    grain = 0.7 * np.sin(x * 113.0 + z * 137.0) * np.sin(y * 101.0 - z * 91.0)
    r, g, b = 244.0 + grain, 244.0 + grain, 240.0 + grain
    ax = abs(x)
    if z >= 0.402 or mode in (1, 3):
        front = 1.0 - smooth(-0.245, -0.18, y)
        if mode == 3:
            # Reference mascot: pale fur, cyan inner ears, charcoal dot eyes,
            # broad soft cheek blush, and a small dark muzzle expression.
            r, g, b = 249.0 + grain, 249.0 + grain, 246.0 + grain
            ear_x = min(abs(x - 0.266), abs(x + 0.266))
            ear = (ear_x / 0.057) ** 2 + ((z - 0.891) / 0.068) ** 2
            if ear < 1.0 and y < -0.028:
                t = (1.0 - smooth(0.65, 1.0, ear)) * 0.78
                r, g, b = mix(r, 126.0, t), mix(g, 225.0, t), mix(b, 238.0, t)
            cheek = (min(abs(x - 0.225), abs(x + 0.225)) / 0.100) ** 2 + ((z - 0.626) / 0.130) ** 2
            if cheek < 1.0:
                t = (1.0 - smooth(0.24, 1.0, cheek)) * front * 0.23
                r, g, b = mix(r, 240.0, t), mix(g, 146.0, t), mix(b, 166.0, t)
            eye = (min(abs(x - 0.091), abs(x + 0.091)) / 0.012) ** 2 + ((z - 0.704) / 0.014) ** 2
            if eye < 1.0:
                t = (1.0 - smooth(0.70, 1.0, eye)) * front
                r, g, b = mix(r, 34.0, t), mix(g, 37.0, t), mix(b, 37.0, t)
            nose = (x / 0.014) ** 2 + ((z - 0.668) / 0.011) ** 2
            if nose < 1.0:
                t = (1.0 - smooth(0.62, 1.0, nose)) * front
                r, g, b = mix(r, 35.0, t), mix(g, 36.0, t), mix(b, 36.0, t)
            return np.uint8(r), np.uint8(g), np.uint8(b)
        # Soft rosy inner ears.
        ear_x = min(abs(x - 0.266), abs(x + 0.266))
        ear = (ear_x / 0.061) ** 2 + ((z - 0.891) / 0.074) ** 2
        if ear < 1.0 and y < -0.028:
            t = (1.0 - smooth(0.72, 1.0, ear)) * 0.70
            r, g, b = mix(r, 225.0, t), mix(g, 165.0, t), mix(b, 169.0, t)
        # Muzzle and cheeks.
        muzzle = (x / 0.108) ** 2 + ((z - 0.626) / 0.075) ** 2
        if muzzle < 1.0:
            t = (1.0 - smooth(0.79, 1.0, muzzle)) * front * 0.85
            r, g, b = mix(r, 251.0, t), mix(g, 251.0, t), mix(b, 248.0, t)
        cheek = (min(abs(x - 0.146), abs(x + 0.146)) / 0.048) ** 2 + ((z - 0.613) / 0.034) ** 2
        if cheek < 1.0:
            t = (1.0 - smooth(0.4, 1.0, cheek)) * front * 0.20
            r, g, b = mix(r, 233.0, t), mix(g, 134.0, t), mix(b, 152.0, t)
        # Two eyes, small highlights, and a dark nose.
        eye = (min(abs(x - 0.091), abs(x + 0.091)) / 0.018) ** 2 + ((z - 0.704) / 0.020) ** 2
        if eye < 1.0:
            t = (1.0 - smooth(0.64, 1.0, eye)) * front
            r, g, b = mix(r, 20.0, t), mix(g, 60.0, t), mix(b, 101.0, t)
        shine = (min(abs(x - 0.085), abs(x + 0.085)) / 0.0045) ** 2 + ((z - 0.712) / 0.005) ** 2
        if shine < 1.0:
            t = (1.0 - smooth(0.5, 1.0, shine)) * front
            r, g, b = mix(r, 250.0, t), mix(g, 247.0, t), mix(b, 236.0, t)
        nose = (x / 0.019) ** 2 + ((z - 0.668) / 0.013) ** 2
        if nose < 1.0:
            t = (1.0 - smooth(0.63, 1.0, nose)) * front
            r, g, b = mix(r, 27.0, t), mix(g, 73.0, t), mix(b, 114.0, t)
        return np.uint8(r), np.uint8(g), np.uint8(b)

    # Dark navy coveralls with shaped orange panels like the supplied photo.
    r, g, b = 18.0 + grain * 0.6, 32.0 + grain * 0.6, 56.0 + grain * 0.6
    front = 1.0 - smooth(-0.055, -0.015, y)
    back = smooth(0.015, 0.055, y)
    orange = 0.0
    shoulder = smooth(0.323, 0.333, z) * smooth(0.068, 0.087, ax)
    sleeve = smooth(0.190, 0.205, z) * (1.0 - smooth(0.340, 0.355, z)) * smooth(0.160, 0.178, ax)
    inner_edge = 0.058 + 0.18 * (0.355 - z)
    chest = (smooth(0.250, 0.263, z) * (1.0 - smooth(0.352, 0.364, z))
             * smooth(inner_edge - 0.006, inner_edge + 0.006, ax)
             * (1.0 - smooth(0.139, 0.155, ax)) * front)
    back_yoke = smooth(0.332, 0.345, z) * back
    orange = max(shoulder, sleeve, chest, back_yoke)
    orange *= 1.0 - smooth(0.382, 0.397, z)
    r, g, b = mix(r, 238.0, orange), mix(g, 87.0, orange), mix(b, 22.0, orange)
    # Fine lighter piping at the panel edges.
    edge = (front * smooth(0.267, 0.276, z) * (1.0 - smooth(0.336, 0.347, z))
            * (1.0 - smooth(0.003, 0.007, abs(ax - inner_edge))))
    r, g, b = mix(r, 252.0, edge * 0.7), mix(g, 155.0, edge * 0.7), mix(b, 62.0, edge * 0.7)
    # Grey reflective bands, cuffs, and charcoal boots.
    leg = smooth(0.084, 0.090, z) * (1.0 - smooth(0.109, 0.115, z)) * smooth(0.055, 0.066, ax)
    cuff = smooth(0.189, 0.195, z) * (1.0 - smooth(0.207, 0.213, z)) * smooth(0.175, 0.189, ax)
    reflective = max(leg, cuff)
    r, g, b = mix(r, 188.0, reflective), mix(g, 202.0, reflective), mix(b, 199.0, reflective)
    waist_seam = (1.0 - smooth(0.002, 0.0045, abs(z - 0.205))) * (1.0 - smooth(0.155, 0.174, ax))
    r, g, b = mix(r, 76.0, waist_seam * 0.65), mix(g, 101.0, waist_seam * 0.65), mix(b, 120.0, waist_seam * 0.65)
    boot = 1.0 - smooth(0.039, 0.050, z)
    r, g, b = mix(r, 27.0, boot), mix(g, 29.0, boot), mix(b, 33.0, boot)
    # Zipper and two chest pocket seams on the front only.
    zipper = front * smooth(0.232, 0.240, z) * (1.0 - smooth(0.371, 0.380, z)) * (1.0 - smooth(0.001, 0.004, ax))
    r, g, b = mix(r, 170.0, zipper), mix(g, 176.0, zipper), mix(b, 171.0, zipper)
    pocket_x = min(abs(x - 0.083), abs(x + 0.083))
    pocket = front * smooth(0.266, 0.271, z) * (1.0 - smooth(0.307, 0.312, z))
    border = (1.0 - smooth(0.002, 0.005, min(abs(pocket_x - 0.034), abs(z - 0.274), abs(z - 0.307))))
    border *= pocket * (1.0 - smooth(0.035, 0.040, pocket_x))
    r, g, b = mix(r, 95.0, border), mix(g, 120.0, border), mix(b, 133.0, border)
    return np.uint8(max(0, min(255, r))), np.uint8(max(0, min(255, g))), np.uint8(max(0, min(255, b)))


@njit(cache=True)
def rasterize_atlas(vertices, faces, uv, uv_faces, size, mode):
    texture = np.zeros((size, size, 3), dtype=np.uint8)
    painted = np.zeros((size, size), dtype=np.uint8)
    for fi in range(len(faces)):
        i0, i1, i2 = faces[fi, 0], faces[fi, 1], faces[fi, 2]
        t0, t1, t2 = uv_faces[fi, 0], uv_faces[fi, 1], uv_faces[fi, 2]
        x0, y0 = uv[t0, 0] * (size - 1), (1.0 - uv[t0, 1]) * (size - 1)
        x1, y1 = uv[t1, 0] * (size - 1), (1.0 - uv[t1, 1]) * (size - 1)
        x2, y2 = uv[t2, 0] * (size - 1), (1.0 - uv[t2, 1]) * (size - 1)
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-10:
            continue
        left = max(0, int(np.floor(min(x0, x1, x2))))
        right = min(size - 1, int(np.ceil(max(x0, x1, x2))))
        top = max(0, int(np.floor(min(y0, y1, y2))))
        bottom = min(size - 1, int(np.ceil(max(y0, y1, y2))))
        for py in range(top, bottom + 1):
            for px in range(left, right + 1):
                sx, sy = px + 0.5, py + 0.5
                w0 = ((y1 - y2) * (sx - x2) + (x2 - x1) * (sy - y2)) / den
                w1 = ((y2 - y0) * (sx - x2) + (x0 - x2) * (sy - y2)) / den
                w2 = 1.0 - w0 - w1
                if w0 < -0.001 or w1 < -0.001 or w2 < -0.001:
                    continue
                x = w0 * vertices[i0, 0] + w1 * vertices[i1, 0] + w2 * vertices[i2, 0]
                y = w0 * vertices[i0, 1] + w1 * vertices[i1, 1] + w2 * vertices[i2, 1]
                z = w0 * vertices[i0, 2] + w1 * vertices[i1, 2] + w2 * vertices[i2, 2]
                r, g, b = painted_color(x, y, z, mode)
                texture[py, px, 0] = r
                texture[py, px, 1] = g
                texture[py, px, 2] = b
                painted[py, px] = 255
    return texture, painted


def texture_png(vertices, faces, uv, uv_faces, size, path, mode=0):
    texture, mask = rasterize_atlas(vertices, faces, uv, uv_faces, size, mode)
    # Pad UV island borders to avoid black seams when the renderer interpolates.
    rgb = texture.copy()
    filled = mask.copy()
    kernel = np.ones((3, 3), np.uint8)
    for _ in range(8):
        grow = cv2.dilate(rgb, kernel)
        next_mask = cv2.dilate(filled, kernel)
        new = (filled == 0) & (next_mask != 0)
        rgb[new] = grow[new]
        filled = next_mask
    if np.any(filled == 0):
        from scipy.ndimage import distance_transform_edt

        missing = filled == 0
        nearest = distance_transform_edt(missing, return_distances=False, return_indices=True)
        rgb[missing] = rgb[nearest[0][missing], nearest[1][missing]]
    Image.fromarray(rgb).save(path, optimize=True)
    return rgb


def gltf_data(vertices, faces, uv, uv_faces, normals):
    pairs = np.column_stack((faces.ravel(), uv_faces.ravel()))
    unique, inverse = np.unique(pairs, axis=0, return_inverse=True)
    indices = inverse.reshape(-1, 3).astype("<u4")
    pos = vertices[unique[:, 0]]
    norm = normals[unique[:, 0]]
    texcoord = uv[unique[:, 1]].copy()
    # FBX/OBJ use a lower-left UV origin; glTF uses the image's upper-left.
    texcoord[:, 1] = 1.0 - texcoord[:, 1]
    to_y_up = lambda v: np.column_stack((v[:, 0], v[:, 2], -v[:, 1])).astype("<f4")
    return to_y_up(pos), to_y_up(norm), texcoord.astype("<f4"), indices


def stylize_proportions(vertices):
    styled = vertices.copy()
    body = vertices[:, 2] <= 0.400
    styled[body, 0] *= 1.15
    styled[body, 1] *= 1.10
    styled[body, 2] *= 1.32
    styled[~body, 2] += 0.128
    return styled


def helmet_meshes():
    """Return white shell/brim and navy lower band in source Z-up space."""
    base = 1.025
    rx, ry, rz = 0.252, 0.219, 0.132
    rings, segments = 13, 48
    dome_vertices = []
    for ring in range(rings + 1):
        theta = (ring / rings) * np.pi / 2
        for segment in range(segments):
            phi = 2 * np.pi * segment / segments
            dome_vertices.append((rx * np.sin(theta) * np.cos(phi),
                                  ry * np.sin(theta) * np.sin(phi),
                                  base + rz * np.cos(theta)))
    dome_faces = []
    for ring in range(rings):
        for segment in range(segments):
            a = ring * segments + segment
            b = ring * segments + (segment + 1) % segments
            c = (ring + 1) * segments + segment
            d = (ring + 1) * segments + (segment + 1) % segments
            dome_faces.extend(((a, c, b), (b, c, d)))

    brim_vertices = []
    for scale in (0.96, 1.13):
        for segment in range(segments):
            phi = 2 * np.pi * segment / segments
            toward_front = max(0.0, -np.sin(phi))
            brim_vertices.append((rx * scale * np.cos(phi),
                                  ry * scale * np.sin(phi) - 0.041 * toward_front * (scale - 0.96) / 0.17,
                                  base - 0.008 - 0.011 * toward_front))
    brim_faces = []
    for segment in range(segments):
        a, b = segment, (segment + 1) % segments
        c, d = segments + segment, segments + (segment + 1) % segments
        brim_faces.extend(((a, c, b), (b, c, d)))

    band_vertices = []
    for height in (base, base + 0.018):
        for segment in range(segments):
            phi = 2 * np.pi * segment / segments
            band_vertices.append((rx * 1.012 * np.cos(phi), ry * 1.012 * np.sin(phi), height))
    band_faces = []
    for segment in range(segments):
        a, b = segment, (segment + 1) % segments
        c, d = segments + segment, segments + (segment + 1) % segments
        band_faces.extend(((a, c, b), (b, c, d)))
    shell_v = np.vstack((np.array(dome_vertices, np.float32), np.array(brim_vertices, np.float32)))
    shell_f = np.vstack((np.array(dome_faces, np.uint32), np.array(brim_faces, np.uint32) + len(dome_vertices)))
    return [(shell_v, shell_f, (236, 242, 243)),
            (np.array(band_vertices, np.float32), np.array(band_faces, np.uint32), (23, 58, 102))]


def append_raw(builder: GlbBuilder, payload: bytes):
    while len(builder.binary) % 4:
        builder.binary.append(0)
    start = len(builder.binary)
    builder.binary.extend(payload)
    builder.views.append({"buffer": 0, "byteOffset": start, "byteLength": len(payload)})
    return len(builder.views) - 1


def make_badge_texture(path):
    image = Image.new("RGBA", (512, 180), (12, 30, 57, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((3, 3, 508, 176), radius=20, outline=(226, 237, 238, 255), width=7)
    font_candidates = [Path("C:/Windows/Fonts/arialbd.ttf"), Path("C:/Windows/Fonts/arial.ttf")]
    font_path = next((p for p in font_candidates if p.exists()), None)
    font = ImageFont.truetype(str(font_path), 103) if font_path else ImageFont.load_default()
    draw.text((256, 88), "POSCO", font=font, fill=(245, 248, 245, 255), anchor="mm")
    image.save(path)


def front_surface_sampler(vertices, zmin, zmax):
    from scipy.spatial import cKDTree

    body = vertices[(vertices[:, 2] > zmin) & (vertices[:, 2] < zmax) & (vertices[:, 1] < 0)]
    tree = cKDTree(body[:, [0, 2]])

    def sample(x, z):
        _, indices = tree.query([x, z], k=40)
        return float(np.min(body[indices, 1])) - 0.005

    return sample


def badge_mesh(vertices, styled=False):
    sample = front_surface_sampler(vertices, 0.31 if styled else 0.23, 0.50 if styled else 0.37)
    xs = np.linspace(-0.086, -0.021, 9) if styled else np.linspace(-0.075, -0.018, 9)
    zs = np.linspace(0.419, 0.447, 5) if styled else np.linspace(0.317, 0.337, 5)
    positions, uvs = [], []
    for row, z in enumerate(zs):
        for col, x in enumerate(xs):
            positions.append((x, sample(x, z), z))
            uvs.append((col / (len(xs) - 1), row / (len(zs) - 1)))
    faces = []
    for row in range(len(zs) - 1):
        for col in range(len(xs) - 1):
            a = row * len(xs) + col
            b = a + 1
            c = a + len(xs)
            d = c + 1
            faces.extend((a, c, b, b, c, d))
    position = np.array(positions, dtype=np.float32)
    y_up = np.column_stack((position[:, 0], position[:, 2], -position[:, 1])).astype("<f4")
    normals = np.tile(np.array([0.0, 0.0, 1.0], dtype=np.float32), (len(position), 1))
    texcoords = np.array(uvs, dtype="<f4")
    texcoords[:, 1] = 1.0 - texcoords[:, 1]
    return y_up, normals, texcoords, np.array(faces, dtype="<u4")


def write_glb(path, vertices, faces, uv, uv_faces, normals, texture_path, badge_path, helmet=False, styled=False):
    pos, norm, texcoord, indices = gltf_data(vertices, faces, uv, uv_faces, normals)
    builder = GlbBuilder()
    attrs = {
        "POSITION": builder.accessor(pos, 5126, "VEC3", 34962),
        "NORMAL": builder.accessor(norm, 5126, "VEC3", 34962),
        "TEXCOORD_0": builder.accessor(texcoord, 5126, "VEC2", 34962),
    }
    offset_pos = pos + norm * 0.0035
    garment_attrs = dict(attrs)
    garment_attrs["POSITION"] = builder.accessor(offset_pos.astype("<f4"), 5126, "VEC3", 34962)
    base_index = builder.accessor(indices.ravel(), 5125, "SCALAR", 34963)
    body_mask = vertices[faces].mean(axis=1)[:, 2] < 0.401
    garment_index = builder.accessor(indices[body_mask].ravel(), 5125, "SCALAR", 34963)
    badge_pos, badge_norm, badge_uv, badge_index = badge_mesh(vertices, styled=styled)
    badge_attrs = {"POSITION": builder.accessor(badge_pos, 5126, "VEC3", 34962),
                   "NORMAL": builder.accessor(badge_norm, 5126, "VEC3", 34962),
                   "TEXCOORD_0": builder.accessor(badge_uv, 5126, "VEC2", 34962)}
    badge_indices = builder.accessor(badge_index, 5125, "SCALAR", 34963)
    image_views = [append_raw(builder, p.read_bytes()) for p in (texture_path, badge_path)]
    primitives = [
        {"attributes": attrs, "indices": base_index, "material": 0},
        {"attributes": garment_attrs, "indices": garment_index, "material": 0},
        {"attributes": badge_attrs, "indices": badge_indices, "material": 1},
    ]
    if helmet:
        for material_idx, (helmet_v, helmet_f, _) in enumerate(helmet_meshes(), start=2):
            helmet_normals = vertex_normals(helmet_v, helmet_f)
            helmet_pos = np.column_stack((helmet_v[:, 0], helmet_v[:, 2], -helmet_v[:, 1])).astype("<f4")
            helmet_norm = np.column_stack((helmet_normals[:, 0], helmet_normals[:, 2], -helmet_normals[:, 1])).astype("<f4")
            helmet_attrs = {"POSITION": builder.accessor(helmet_pos, 5126, "VEC3", 34962),
                            "NORMAL": builder.accessor(helmet_norm, 5126, "VEC3", 34962)}
            helmet_index = builder.accessor(helmet_f.ravel().astype("<u4"), 5125, "SCALAR", 34963)
            primitives.append({"attributes": helmet_attrs, "indices": helmet_index, "material": material_idx})
    document = {
        "asset": {"version": "2.0", "generator": "ST-ROOKIE Posukho uniform v2"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "Posukho - navy and orange POSCO uniform", "mesh": 0}],
        "meshes": [{"primitives": primitives}],
        "images": [{"bufferView": v, "mimeType": "image/png"} for v in image_views],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "textures": [{"sampler": 0, "source": i} for i in range(2)],
        "materials": [
            {"name": "baked_fur_and_uniform", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 0.89}, "doubleSided": True},
            {"name": "chest_badge", "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}, "metallicFactor": 0.0, "roughnessFactor": 0.75}, "doubleSided": True},
            {"name": "white_safety_helmet", "pbrMetallicRoughness": {"baseColorFactor": [0.92, 0.95, 0.96, 1], "metallicFactor": 0.0, "roughnessFactor": 0.61}, "doubleSided": True},
            {"name": "helmet_navy_band", "pbrMetallicRoughness": {"baseColorFactor": [0.09, 0.23, 0.40, 1], "metallicFactor": 0.0, "roughnessFactor": 0.69}, "doubleSided": True},
        ],
    }
    builder.finish(document, path)
    return len(pos), int(np.sum(body_mask))


def write_garment_obj(path, vertices, faces, uv, uv_faces, normals, texture_name):
    use = vertices[faces].mean(axis=1)[:, 2] < 0.401
    faces = faces[use]
    uv_faces = uv_faces[use]
    pairs = np.column_stack((faces.ravel(), uv_faces.ravel()))
    unique, inverse = np.unique(pairs, axis=0, return_inverse=True)
    positions = vertices[unique[:, 0]] + normals[unique[:, 0]] * 0.0035
    texcoords = uv[unique[:, 1]]
    indices = inverse.reshape(-1, 3) + 1
    with path.with_suffix(".mtl").open("w", encoding="ascii") as f:
        f.write(f"newmtl uniform\nKd 1 1 1\nmap_Kd {texture_name}\n")
    with path.open("w", encoding="ascii", newline="\n") as f:
        f.write(f"mtllib {path.with_suffix('.mtl').name}\no posukho_tailored_uniform\n")
        for x, y, z in positions:
            f.write(f"v {x:.7f} {y:.7f} {z:.7f}\n")
        for u, v in texcoords:
            f.write(f"vt {u:.7f} {v:.7f}\n")
        f.write("usemtl uniform\n")
        for a, b, c in indices:
            f.write(f"f {a}/{a} {b}/{b} {c}/{c}\n")


def render_preview(path, vertices, faces, uv, uv_faces, texture, front=True, helmet=False, styled=False, angle=0.0):
    width, height = 720, 900
    image = np.full((height, width, 3), (238, 242, 245), dtype=np.uint8)
    scale = 690 if styled else 805
    top = 1.25 if styled else 1.04
    radians = np.deg2rad(angle)
    horizontal = vertices[:, 0] * np.cos(radians) - vertices[:, 1] * np.sin(radians)
    viewed_depth = vertices[:, 0] * np.sin(radians) + vertices[:, 1] * np.cos(radians)
    px = np.column_stack(((horizontal + 0.45) * scale + 28, (top - vertices[:, 2]) * scale + 18)).astype(np.int32)
    depth = viewed_depth[faces].mean(axis=1)
    visible = np.arange(len(faces)) if angle else np.flatnonzero(depth < 0 if front else depth >= 0)
    order = visible[np.argsort(-depth[visible] if front else depth[visible])]
    face_uv = uv[uv_faces].mean(axis=1)
    tx = np.clip((face_uv[:, 0] * (texture.shape[1] - 1)).astype(np.int32), 0, texture.shape[1] - 1)
    ty = np.clip(((1.0 - face_uv[:, 1]) * (texture.shape[0] - 1)).astype(np.int32), 0, texture.shape[0] - 1)
    color = texture[ty, tx]
    coords = vertices[faces]
    normal = np.cross(coords[:, 1] - coords[:, 0], coords[:, 2] - coords[:, 0])
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-12)
    light = np.array([0.3, -0.75 if front else 0.75, 0.55], dtype=np.float32)
    shade = np.clip(0.78 + 0.20 * np.sum(normal * light, axis=1), 0.56, 1.0)
    # Paint the source mesh first, then depth-order the helmet against it.
    if helmet:
        meshes = helmet_meshes()
        extra_pixels, extra_depth, extra_colors = [], [], []
        for helmet_v, helmet_f, rgb in meshes:
            hpx = np.column_stack(((helmet_v[:, 0] + 0.45) * scale + 28, (top - helmet_v[:, 2]) * scale + 18)).astype(np.int32)
            extra_pixels.append(hpx[helmet_f])
            extra_depth.append(helmet_v[helmet_f, 1].mean(axis=1))
            extra_colors.append(np.tile(np.array(rgb, np.uint8), (len(helmet_f), 1)))
        head_faces = np.concatenate(extra_pixels)
        head_depth = np.concatenate(extra_depth)
        head_colors = np.concatenate(extra_colors)
        keep = head_depth < 0 if front else head_depth >= 0
        # The helmet sits above the head; draw it after the bear for preview.
    for fi in order:
        rgb = (color[fi] * shade[fi]).astype(np.uint8)
        cv2.fillConvexPoly(image, px[faces[fi]], tuple(int(v) for v in rgb[::-1]), lineType=cv2.LINE_AA)
    if helmet:
        for hfi in np.flatnonzero(keep)[np.argsort(-head_depth[keep] if front else head_depth[keep])]:
            rgb = head_colors[hfi]
            cv2.fillConvexPoly(image, head_faces[hfi], tuple(int(v) for v in rgb[::-1]), lineType=cv2.LINE_AA)
    if front:
        # Badge is tiny at this size; draw the readable mark at its actual location.
        cv2.putText(image, "POSCO", (int((-.062 + .45) * scale + 28), int((top - .43) * scale + 18)), cv2.FONT_HERSHEY_SIMPLEX, 0.26, (232, 238, 243), 1, cv2.LINE_AA)
    ok, png = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("Preview PNG encoding failed")
    path.write_bytes(png.tobytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fbx", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    parser.add_argument("--size", type=int, default=2048)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    vertices, faces, uv, uv_faces = load_mesh_and_uv(args.fbx)
    normals = vertex_normals(vertices, faces)
    texture_path = args.output / "posukho_uniform_texture.png"
    texture = texture_png(vertices, faces, uv, uv_faces, args.size, texture_path)
    badge_path = args.output / "posukho_badge.png"
    make_badge_texture(badge_path)
    glb_path = args.output / "posukho_uniform_v2.glb"
    count, garment_faces = write_glb(glb_path, vertices, faces, uv, uv_faces, normals, texture_path, badge_path)
    obj_path = args.output / "posukho_uniform_v2.obj"
    write_garment_obj(obj_path, vertices, faces, uv, uv_faces, normals, texture_path.name)
    render_preview(args.output / "uniform_v2_front.png", vertices, faces, uv, uv_faces, texture, True)
    render_preview(args.output / "uniform_v2_back.png", vertices, faces, uv, uv_faces, texture, False)
    styled = stylize_proportions(vertices)
    styled_normals = vertex_normals(styled, faces)
    styled_path = args.output / "posukho_uniform_styled.glb"
    write_glb(styled_path, styled, faces, uv, uv_faces, styled_normals, texture_path, badge_path, styled=True)
    render_preview(args.output / "uniform_styled_front.png", styled, faces, uv, uv_faces, texture, True, styled=True)
    render_preview(args.output / "uniform_styled_back.png", styled, faces, uv, uv_faces, texture, False, styled=True)
    render_preview(args.output / "uniform_styled_three_quarter.png", styled, faces, uv, uv_faces, texture, True, styled=True, angle=22.0)
    print(f"GLB {glb_path.stat().st_size} bytes; {count} vertices, {garment_faces} garment faces")
    print(f"Texture {texture_path.stat().st_size} bytes; OBJ {obj_path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
