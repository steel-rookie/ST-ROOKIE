# Steel Academy 교육 MVP

열연 공정을 3D 개념 모델로 살펴보는 독립 실행형 교육 데모입니다.

## 실행

- 빠르게 보기: [steel-academy.html](steel-academy.html)을 최신 Chrome 또는 Edge에서 엽니다. 인터넷 연결과 API 키가 필요하지 않습니다.
- 소스 수정: `source/`에서 `python -m http.server 8000`을 실행한 뒤 `http://localhost:8000`을 엽니다.

설비 선택, 3D 회전과 확대, 공정 재생과 속도 조절, 예시 튜터, 3문항 퀴즈, GLB 다운로드를 제공합니다. 수정 가능한 파일은 `source/`에 있으며, 포함된 Three.js 배포 파일의 라이선스는 `source/vendor/THREE-LICENSE.txt`에 있습니다.

튜터 답변은 준비된 예시이며 실제 LLM과 연결되지 않았습니다. 3D는 실제 설비 도면이나 물리 시뮬레이션이 아닌 교육용 개념 모형입니다. 실제 조업과 안전 판단에는 승인된 현장 지침을 사용해야 합니다.
