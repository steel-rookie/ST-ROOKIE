# 이해도 확인 캐릭터 모델

이해도 확인 오버레이의 캐릭터(`<cp-character>`, `cp-character.js`)가 읽는 모델. 설계: [docs/checkpoint-overlay.md](../../../../docs/checkpoint-overlay.md)

## 출처·라이선스

| 항목 | 내용 |
|---|---|
| 파일 | `tutor.glb` |
| 출처(제작 도구·사이트·제작자) | |
| 원본 링크 또는 원본 파일 위치 | |
| 라이선스 | |
| 상업적 이용 가능 여부 | |
| 표기 의무(크레딧) | |
| 받은 날짜 | |
| 수정 내역(폴리곤 줄이기, 재질 수정 등) | 아래 '수정 내역' |

## 수정 내역

2026-10-08. 원본: Tripo에서 텍스처 포함으로 받은 `bear+3d+model.glb`(15.7 MB, 삼각형 501,242개, 텍스처 512×512 JPEG 3장). 원본은 저장소에 넣지 않는다.

도구: `@gltf-transform/cli` 4.5.1 (`npx @gltf-transform/cli@4.5.1 …`), Node 24.

```sh
gltf-transform weld     원본.glb  w.glb                               # 겹친 꼭짓점 합치기
gltf-transform simplify w.glb     s.glb --ratio 0.06 --error 0.001    # 폴리곤 줄이기
gltf-transform quantize s.glb     tutor.glb                           # 좌표·법선을 작은 숫자 형식으로(KHR_mesh_quantization)
```

결과: 1.76 MB, 삼각형 72,952개. 텍스처는 1024px보다 작아 크기를 바꾸지 않았다(원본과 같음). 재질은 수정하지 않았다.
`quantize`가 배율·위치를 노드에 넣으므로 크기는 노드 변환을 포함한 바운딩 박스로 잰다.

## 규칙

- 형식: glTF 2.0 binary(.glb). Draco 압축은 쓰지 않는다. 텍스처는 파일 안에 포함한다.
- 기준점: 발 중앙이 원점, 바닥이 Y=0, 얼굴이 +Z 방향. 크기는 코드가 바운딩 박스로 맞추므로 단위는 상관없다.
- 재질: Base Color(또는 텍스처)를 정하고 Metallic은 0. 재질 값이 비어 있으면 glTF 기본값(금속성 1)이 적용되어 어둡게 보인다.
- 용량: 오버레이용 작은 캐릭터라 삼각형 수만 개, 수 MB 이내를 목표로 한다. 줄이는 방법은 설계 문서 '캐릭터 모델 현황'.
- 동작: 뼈대·애니메이션이 없어도 된다(몸 전체 움직임으로 대체). 애니메이션 클립을 넣으면 클립 이름을 동작 이름표와 같게 한다:
  `idle`, `greet`, `ask`, `ask_again`, `praise`, `explain`, `encourage`, `thinking`, `celebrate`, `cheer_retry`, `sorry`.
  이름이 맞는 클립은 클립으로, 없는 동작은 몸 전체 움직임으로 보인다.
