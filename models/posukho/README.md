# 포석호 작업복 — 원본 얼굴 유지

첨부된 캐릭터 이미지의 둥근 얼굴과 단순한 표정에 맞춰 다시 만든 모델은 **`posukho_reference_rebuilt.glb`**입니다. 머리·귀·눈·코·입을 별도 메시로 만들고 볼 색은 머리 텍스처에 부드럽게 칠했습니다. 제복은 원본 FBX 몸체에 맞춘 분리 셸을 사용했습니다. `reference_rebuilt_front.png`와 `reference_rebuilt_three_quarter.png`에서 확인할 수 있습니다. 원본 FBX 파일은 수정하지 않았습니다.

원본 FBX의 얼굴과 재질을 그대로 쓰려면 **`posukho_outfit_only.glb`**를 사용하세요. 이 GLB에는 옷 메시와 옷 재질만 들어 있습니다. 원본 FBX와 같은 원점에 불러오면 옷을 겹쳐 입힐 수 있습니다.

## 가져오기

Blender에서 원본 FBX를 먼저 가져온 다음 `posukho_outfit_only.glb`를 가져오세요. 두 오브젝트의 위치와 배율은 기본값으로 두면 됩니다. FBX의 기존 얼굴 재질과 텍스처도 그대로 사용하세요. `outfit_only_front.png`는 옷만 표시한 정면 미리보기라 얼굴이 보이지 않습니다.

## 옷 구조

- 상의: 앞판 왼쪽·오른쪽, 등판. 앞판 사이에 지퍼 틈, 테이프, 이빨을 별도 메시로 구성했습니다.
- 하의: 상의와 별도 메시로 분리했습니다. 상·하의 절단 기준은 원본 FBX의 `Z=0.205`입니다.
- 옷깃: 좌우 별도 메시입니다.
- 상의·하의는 원본 몸 표면에서 0.002 모델 단위(0.2cm) 바깥으로 올리고, 안쪽 면과 절단면을 닫아 0.2cm 두께로 만들었습니다.
- 상의와 하의는 각각 `posukho_cloth_paint.png`, `posukho_pants_paint.png`로 따로 칠할 수 있습니다. GLB에도 두 이미지가 내장되어 있습니다.

원본 FBX에는 외부 텍스처 참조가 있지만 그 이미지 파일은 전달받지 못했습니다. 이 결과물에는 얼굴 재질을 새로 만들거나 덮어쓴 부분이 없습니다.

## 재생성과 확인

```powershell
python models/posukho/build_layered_uniform.py "원본 FBX 경로"
python models/posukho/validate_layered.py models/posukho/posukho_outfit_only.glb
python models/posukho/validate_layered.py models/posukho/posukho_reference_rebuilt.glb
python models/posukho/render_layered.py models/posukho/posukho_outfit_only.glb models/posukho/outfit_only_front.png
```

이전 `posukho_reference_uniform.glb`, `posukho_layered_*`, `posukho_uniform_*` 파일은 구버전입니다. 원본 얼굴을 유지하려면 **outfit_only** 파일을 사용하세요.
