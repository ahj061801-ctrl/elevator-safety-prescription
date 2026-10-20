# 승강기 안전처방전

GitHub Pages 기반 안전처방전 작성 화면에 GitHub 계정 로그인, PDF 자동 보관, 발급대장 조회 기능을 연결하기 위한 저장소입니다.

## 현재 구성
- `index.html`: 기존 처방전 작성 화면
- `docs/issuance-system-design.md`: 구현 범위 및 운영 설계
- `supabase/migrations/`: 발급대장 DB 스키마
- `supabase/functions/`: 발급 및 PDF 다운로드용 Edge Functions
- `supabase/SETUP.md`: Supabase 및 GitHub OAuth 설정 안내

## 목표 사용 방식
- 검사원은 GitHub 계정으로 로그인
- 관리자가 등록한 활성 사용자는 지사 발급대장 전체 조회 가능
- 발급 건 상세 확인, PDF 열기 및 다운로드
- 새 처방전 발급 시 PDF와 발급 정보 자동 저장

## 현재 상태
백엔드 초기 파일과 설정 안내는 저장되어 있지만, Supabase 프로젝트 생성·배포 및 웹 화면 연결은 아직 완료되지 않았습니다. 따라서 현재 공개 웹앱은 기존의 브라우저 PDF 저장 방식으로 동작합니다.

## 주의
- GitHub Pages는 로그인 여부를 자동으로 제한하지 않으므로 웹앱에서 OAuth 로그인을 직접 연결해야 합니다.
- 실제 PDF는 공개 GitHub 저장소에 올리지 않습니다. PDF는 비공개 Storage에 저장합니다.
- service-role key와 비밀번호는 GitHub 저장소나 브라우저 코드에 넣지 않습니다.
- 실제 검사자료를 쓰기 전에 기관의 외부 클라우드 사용 규정을 확인하고, 그 전에는 테스트 자료만 사용하세요.
