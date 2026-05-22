#!/usr/bin/env bash
# EUC-KR 인코딩 재해석 테스트용 로그 파일 생성기
#
# 파일 자체는 UTF-8이지만, 한글 부분만 EUC-KR 바이트로 기록됨.
# → Logr에서 UTF-8로 열면 한글이 깨져 보임
# → 깨진 부분 선택 → EUC-KR로 변환 시 정상 출력 확인 가능
#
# 사용법: ./scripts/generate_mixed_encoding.sh [출력파일경로]
# 기본값: /tmp/mixed-encoding-test.log

LOG_FILE="${1:-/tmp/mixed-encoding-test.log}"

# iconv 로 한글 문자열을 EUC-KR 바이트로 인코딩하는 헬퍼
# 결과는 raw bytes (UTF-8 쉘에서 깨진 문자로 출력됨 — 의도적)
euckr() {
  printf '%s' "$1" | iconv -f UTF-8 -t EUC-KR 2>/dev/null
}

ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 파일 초기화
: > "$LOG_FILE"

echo "로그 파일: $LOG_FILE"
echo "인코딩: UTF-8 기반 + 한글 부분 EUC-KR 바이트 혼재"
echo ""

# ── 1. 순수 UTF-8 영문 헤더 ─────────────────────────────────────
{
  echo "$(ts) [INFO]  [App] ============================================"
  echo "$(ts) [INFO]  [App] Application started (UTF-8 log, EUC-KR Korean)"
  echo "$(ts) [INFO]  [App] ============================================"
} >> "$LOG_FILE"

# ── 2. 정상 UTF-8 라인 ──────────────────────────────────────────
{
  echo "$(ts) [INFO]  [AuthService] Server listening on :8080"
  echo "$(ts) [DEBUG] [UserService] Loading user profile for user_1042"
  echo "$(ts) [INFO]  [ApiGateway] GET /api/v1/users 200 OK (45ms)"
} >> "$LOG_FILE"

# ── 3. EUC-KR 바이트가 포함된 WARN 라인 ─────────────────────────
# 아래 줄은 파일에서 UTF-8로 보면 한글 부분이 깨져 보임
printf "$(ts) [WARN]  [PaymentService] " >> "$LOG_FILE"
euckr "결제 금액 불일치 감지됨" >> "$LOG_FILE"
printf " (user_2837, expected=15000, actual=14900)\n" >> "$LOG_FILE"

# ── 4. 정상 UTF-8 라인 ──────────────────────────────────────────
{
  echo "$(ts) [INFO]  [AuthService] user_4412 POST /api/v1/login 201 Created (88ms)"
  echo "$(ts) [DEBUG] [Cache] Cache hit for key='session:user_9901' ttl=3542s"
} >> "$LOG_FILE"

# ── 5. EUC-KR 바이트가 포함된 ERROR 라인 ────────────────────────
printf "$(ts) [ERROR] [DBService] " >> "$LOG_FILE"
euckr "데이터베이스 연결 시간 초과" >> "$LOG_FILE"
printf " — reconnecting (attempt 1/3)\n" >> "$LOG_FILE"

# ── 6. 정상 UTF-8 라인 ──────────────────────────────────────────
{
  echo "$(ts) [INFO]  [ApiGateway] GET /api/v1/orders 200 OK (120ms)"
  echo "$(ts) [WARN]  [RateLimit] user_7756 approaching limit (980/1000 req/min)"
} >> "$LOG_FILE"

# ── 7. EUC-KR 바이트가 포함된 INFO 라인 (여러 종류) ──────────────
printf "$(ts) [INFO]  [NotificationService] " >> "$LOG_FILE"
euckr "사용자 알림 발송 완료" >> "$LOG_FILE"
printf " (user_1042, channel=email)\n" >> "$LOG_FILE"

printf "$(ts) [WARN]  [UserService] " >> "$LOG_FILE"
euckr "비밀번호 5회 오류" >> "$LOG_FILE"
printf " — account locked (user_3391)\n" >> "$LOG_FILE"

printf "$(ts) [ERROR] [PaymentService] " >> "$LOG_FILE"
euckr "카드 승인 실패: 한도 초과" >> "$LOG_FILE"
printf " (user_5512, card=****1234)\n" >> "$LOG_FILE"

# ── 8. 마지막 정상 UTF-8 라인 ───────────────────────────────────
{
  echo "$(ts) [DEBUG] [App] GC completed in 12ms, freed 128MB"
  echo "$(ts) [INFO]  [App] Health check OK"
  echo "$(ts) [INFO]  [App] ============================================"
  echo "$(ts) [INFO]  [App] ^ Above Korean text is EUC-KR encoded bytes"
  echo "$(ts) [INFO]  [App] Select garbled text → right-click → Re-encode as EUC-KR"
  echo "$(ts) [INFO]  [App] ============================================"
} >> "$LOG_FILE"

echo "완료! 총 $(wc -l < "$LOG_FILE")줄 생성됨"
echo ""
echo "테스트 방법:"
echo "  1. Logr에서 파일 열기: $LOG_FILE"
echo "  2. 인코딩: UTF-8 로 열기"
echo "  3. 깨진 한글 부분 드래그 선택"
echo "  4. 우클릭 → '선택 영역 인코딩 변환' → EUC-KR"
echo "  5. 한글이 정상으로 표시되는지 확인"
