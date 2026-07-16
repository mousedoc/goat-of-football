# THE GOAT INDEX

[![Analyze and publish report](https://github.com/mousedoc/goat-of-football/actions/workflows/pages.yml/badge.svg)](https://github.com/mousedoc/goat-of-football/actions/workflows/pages.yml)

축구 역사상 최고의 선수라는 질문을 특정 선수의 팬심이 아니라 공개된 가정, 양방향 근거, 구조적 불확실성, 가중치 민감도로 분석한 한국어 데이터 보고서입니다.

**공개 보고서:** <https://mousedoc.github.io/goat-of-football/>

## 결론을 읽는 법

현재 증거 잠금일은 **2026-06-10**입니다. 진행 중인 2026 FIFA 월드컵은 순위에 넣지 않았습니다.

- 기본 균형 모델에서는 리오넬 메시가 1위입니다.
- 40,000회 민감도 모의실험의 1위 도달률은 메시 69.4%, 크리스티아누 호날두 19.8%, 펠레 10.5%입니다.
- 대표팀 우선 시나리오에서는 펠레, 지속성 우선에서는 크리스티아누 호날두가 1위입니다.
- 이 비율은 “실제로 GOAT일 확률”이 아니라, 이 저장소가 공개한 입력 범위와 합리적 가치 가중치 안에서 결론이 유지되는 비율입니다.

점수의 95%는 Peak 3, Prime 5, Career AUC, 클럽·대표팀 맥락으로 구성됩니다. 개인상과 팀 트로피는 국적·팀 자원·시대별 수상 자격의 영향을 크게 받으므로 5%만 반영합니다.

## 왜 단일 통계표가 아닌가

전 시대에 공통으로 존재하는 xG, xA, 출전시간, 도움, 압박, 온·오프 데이터는 없습니다. “자료 없음”을 0점으로 만들면 과거 선수·수비수·골키퍼가 자동으로 불리해집니다. 이 프로젝트는 다음 원칙을 사용합니다.

1. 공식 기록, 동시대 평가, 독립 패널, 역할 증거를 서로 교차검증합니다.
2. 각 차원을 하나의 확정값이 아니라 `[보수적 하한, 최빈값, 상한]`으로 저장합니다.
3. 자료가 적은 시대일수록 더 넓은 범위를 부여합니다.
4. 여섯 가치 시나리오를 같은 확률로 선택하고 그 주변의 가중치를 표집합니다.
5. 업적 수, 친선 포함 통산 득점, 현대 이벤트 지표를 전 시대 공통 핵심 점수로 그대로 합산하지 않습니다.

후보 선정, 차원 루브릭, 갱신 규칙은 [data/README.md](data/README.md)에 더 자세히 설명되어 있습니다.

## 저장소 구조

```text
data/
  candidates.json   # 선수별 양방향 근거, 핵심 사실, 차원 범위
  model.json        # 가중치, 시나리오, 표집 규칙
  sources.json      # 공식·학술·보완 출처 장부
scripts/
  analyze.py        # 검증, 점수 계산, Monte Carlo, Pareto 분석
  build_report.py   # 정적 사이트와 입력 해시 manifest 생성
  validate_report.py# Pages 경로·스키마·출처·접근성 계약 검사
site/               # 의존성 없는 HTML/CSS/JavaScript 보고서
tests/              # 재현성·불변조건·실패 경로 테스트
```

빌드는 외부 Python 패키지나 런타임 CDN을 사용하지 않습니다. GitHub Actions는 공식 액션을 전체 커밋 SHA로 고정하며, PR에서는 분석·검증만 하고 `main`에서만 Pages 배포 권한을 얻습니다.

## 로컬 실행

Python 3.11 이상이 필요합니다.

```powershell
python -m unittest discover -s tests -v
python scripts/build_report.py --output dist
python scripts/validate_report.py dist
python -m http.server 4173 --directory dist
```

그다음 <http://127.0.0.1:4173/>을 엽니다.

## 데이터 갱신

라이브 사이트를 무단 스크래핑하지 않습니다. 작은 검증 스냅샷을 사람이 공식 출처와 대조한 뒤 다음 절차로 갱신합니다.

1. `data/sources.json`에 범위·출처·접근일을 기록합니다.
2. `data/candidates.json`의 사실과 범위를 수정하고 찬성·반대 근거를 함께 갱신합니다.
3. 완료되지 않은 대회는 확정 점수에 승격하지 않습니다.
4. 테스트와 빌드 검증을 통과시킵니다.
5. 생성된 `dist/data/manifest.json`의 SHA-256 입력 장부로 배포를 추적합니다.

후보를 추가하거나 점수를 반박할 때는 선수 이름보다 먼저 어느 차원, 어느 범위, 어느 출처가 바뀌어야 하는지를 제시해 주세요.

## 범위와 한계

이 버전은 **남자 성인 11인제 공식 축구**의 선수 경력만 다룹니다. 여자축구가 열등해서가 아니라 경쟁 생태계와 역사적 데이터 생성 과정이 달라 같은 척도에 억지로 합치면 또 다른 편향이 생기기 때문입니다. 여자축구 GOAT는 별도 후보·리그 강도·대회 접근성 모델이 필요합니다.

현대 심층 데이터는 StatsBomb Open Data의 표본이 메시 경기·특정 결승·일부 완전 대회에 편중되어 있어 핵심 GOAT 점수에 직접 합산하지 않았습니다. 결과는 관측된 사실 그 자체가 아니라 공개 루브릭에 따른 반박 가능한 모델입니다.

## 라이선스와 인용

코드는 [MIT License](LICENSE), 이 저장소가 작성한 보고서 문구와 구조화된 평가 주석은 [CC BY 4.0](DATA_LICENSE.md)으로 제공합니다. FIFA, UEFA, CONMEBOL, France Football, RSSSF, StatsBomb 등 제3자 사실·상표·링크의 권리는 각 권리자에게 있으며 원자료 재배포 라이선스를 부여하지 않습니다.
