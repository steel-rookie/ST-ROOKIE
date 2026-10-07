# 3D 모델(GLB) 넣는 곳

공정별로 파일 하나씩 넣으면 자동으로 기본 도형을 대체합니다. 파일이 없으면 기본 도형이 그대로 보입니다.

- `models/ironmaking.glb` — 제선
- `models/steelmaking.glb` — 제강
- `models/continuous_casting.glb` — 연주
- `models/rolling.glb` — 열간압연

## 규칙
- 설비 노드 이름: `EQ_<설비id>` (예: `EQ_blast_furnace`, `EQ_cc_mold`). 이름이 일치하는 노드만 클릭·하이라이트·라벨·소재 흐름에 연결됩니다. 없는 설비는 기본 도형이 남습니다.
- 배치: 설비들이 X축 −15 ~ +15 에 왼쪽→오른쓽 공정 순서로, 바닥 Y=0 위에 놓이게 해 주세요. 소재는 Z=+3.2 선을 따라 흐릅니다.
- 단위: 1 = 약 1 m 느낌(고로 높이 약 8). 크기가 다르면 3D 툴에서 스케일을 맞춰 내보내세요.
- 형식: glTF 2.0 binary(.glb), 텍스처 임베드. Draco 압축은 사용하지 마세요.
- 용량 줄이기(지금 4개 파일에 적용): Blender에서 겹친 꼭짓점 합치기(Merge by Distance 0.0001)·같은 평면 면 합치기(Limited Dissolve 1°, 재질 경계 유지)·삼각형 쌍을 사각형으로(Tris to Quads)·각도 기준 매끈하게(35°) 정리한 뒤 GLB로 내보내고, `npx @gltf-transform/cli quantize`로 좌표·법선을 작은 숫자 형식(`KHR_mesh_quantization`)으로 저장합니다.
- 마지막으로 `npx @gltf-transform/cli meshopt 입력.glb 출력.glb`로 압축합니다(`EXT_meshopt_compression`, 4개 합계 6.4MB → 2.3MB). 노드 이름·계층·변환과 재질 이름은 그대로라 앵커·2D 팝업(`readGlbGroups`)에 영향이 없습니다. `scene_v2.js`·`scene_v3.js`의 `GLTFLoader`에 `setMeshoptDecoder(MeshoptDecoder)`가 있어야 읽힙니다(옛 `scene.js`에는 없음). 모델을 새로 내보내면 이 단계까지 다시 적용하세요.

로딩 상태는 화면 우측 하단 `MODEL` 표시와 `{ }` 개발자 패널에서 확인할 수 있습니다.
