# 승강기 안전처방전

기존 GitHub Pages 기반 안전처방전 작성 화면과, 별도 Supabase 백엔드를 이용한 비공개 PDF 보관·발급대장 시스템을 위한 저장소입니다.

## 현재 구성
- `index.html`: 기존 처방전 작성 화면
- `docs/issuance-system-design.md`: 아키텍처 및 운영 설계
- `supabase/migrations/001_initial_schema.sql`: 발급대장 DB와 RLS 초기 스키마
- `supabase/migrations/002_issue_number_allocator.sql`: 서버 전용 발급번호 할당 함수
- `supabase/functions/issue-prescription/index.ts`: 인증 기반 발급·PDF 보관 함수
- `supabase/functions/get-prescription-pdf/index.ts`: 권한 확인 후 PDF 다운로드 함수
- `supabase/SETUP.md`: Supabase 초기 설정 체크리스트

## 중요: 아직 운영 연결 전
코드는 백엔드 초기 구현안이며, Supabase 프로젝트·비공개 Storage 버킷·인증 계정·비밀 환경변수는 아직 이 저장소에서 생성할 수 없습니다. 설정을 마치고 프런트엔드에 로그인/발급 API 연결을 구현하기 전까지 현재 공개 웹앱은 기존의 브라우저 PDF 저장 방식으로 동작합니다.

## 보안 주의
- 이 저장소는 공개 저장소이므로 실제 검사자료, PDF, 인증정보, 서비스 역할 키를 절대 커밋하지 마세요.
- 운영 전 기관의 외부 클라우드 사용 승인을 확인하세요.
- 운영 전 RLS, Storage 정책, 발급 중복 요청, 업로드 실패/재시도, 권한 회수 테스트를 수행하세요.
- Supabase service-role key는 Edge Function의 서버 비밀 환경변수에만 저장해야 합니다.
