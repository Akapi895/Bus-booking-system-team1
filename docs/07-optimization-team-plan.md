# 07 — Kế hoạch tối ưu BusBooking và phân công nhóm

**Mốc so sánh:** commit `fd6b5f3` (đề xuất gắn tag `baseline`). Mọi số liệu trước/sau đều so với mốc này.

**Mục tiêu:** giải quyết các bài toán kiến trúc có thật trong code — consistency, transaction design, concurrency, reliability, event-driven, scale-out — và chứng minh bằng test + benchmark trước/sau.

**Phạm vi nhóm:** Backend — System Design. Không làm frontend, thanh toán, chọn ghế cụ thể.

---

## 0. Bối cảnh: Pha 2 — System Design

Tài liệu Pha 1 đã tự ghi rõ những gì còn thiếu:

- [`01` §1.2.2](01-overview-and-requirements.md) đưa **"phân tán tải, message queue và auto-scaling"** ra ngoài phạm vi.
- [`01` §1.7](01-overview-and-requirements.md) nói số liệu tải chỉ là "baseline tham khảo, không phải cam kết SLA" → chưa có yêu cầu phi chức năng nào đo được.

Pha 2 của nhóm lấp đúng các khoảng trống này.

### Yêu cầu phi chức năng Pha 2

| Nhóm | Yêu cầu | Kiểm chứng |
|---|---|---|
| Correctness (bắt buộc) | 0 vé bán vượt ghế · 0 booking trùng cho cùng `Idempotency-Key` · 0 chuyến trùng lịch cùng xe | Script đối soát DB sau **mỗi** lần chạy tải |
| Performance | p95/p99 `POST /api/bookings` và `GET /api/trips` dưới kịch bản hotspot — **chốt con số sau khi có baseline** | Locust + Grafana, so với `baseline` |
| Reliability | Lỗi SMTP/broker không làm hỏng request; thông báo giao ít nhất một lần, consumer chống trùng | Fault injection: tắt Mailpit / RabbitMQ rồi bật lại |
| Scalability | Backend stateless; throughput tăng khi thêm instance cho tới khi DB thành nút cổ chai; rate limit đúng trên toàn cụm | So 1 vs 3 instance sau Nginx |
| Observability | Metrics theo endpoint (rate, error, latency), Hikari pool, lock wait PostgreSQL | Dashboard Grafana |

### Kiến trúc đích

```text
Client / Locust
      │
    Nginx  (load balancer)
      │
 ┌────┴─────┬──────────┐
 Backend #1  Backend #2  Backend #3      (stateless, Spring Boot)
 └────┬─────┴──────────┘
      ├── PostgreSQL   nguồn sự thật: ghế, booking, idempotency, outbox
      ├── Redis        rate limit phân tán
      └── outbox relay ──► RabbitMQ ──► notification consumer ──► SMTP

Prometheus + Grafana thu metrics từ backend, PostgreSQL, Redis, RabbitMQ
```

### Sản phẩm thiết kế mỗi người phải nộp

Code chỉ là một nửa. Mỗi quyết định kiến trúc có một ADR trong `docs/adr/` theo khung: **Bối cảnh (dẫn code hiện tại) → Các phương án → Quyết định → Đánh đổi → Kết quả đo**.

| Người | ADR | Sơ đồ / tài liệu cập nhật |
|---|---|---|
| A | ADR-006 Rate limit phân tán: Redis token bucket vs Nginx `limit_req` vs giữ in-memory | Sơ đồ triển khai đích trong `03` §3.7; tổng hợp báo cáo `08-phase2-results.md` |
| B | ADR-001 Chiến lược khóa khi đặt vé: `FOR UPDATE` + `UPDATE` vs một câu `UPDATE` có điều kiện vs optimistic `@Version` · ADR-002 Lưu idempotency key ở PostgreSQL vs Redis | Sequence diagram đặt vé mới trong `03` §3.5 |
| C | ADR-003 Chống trùng lịch: kiểm tra trong service vs exclusion constraint · ADR-004 Vòng đời chuyến: job định kỳ vs suy ra từ giờ khi đọc | State diagram trạng thái chuyến; cập nhật quy tắc nghiệp vụ `01` §1.5 |
| D | ADR-005 Giao thông báo: gửi đồng bộ vs `@Async` vs outbox + RabbitMQ (at-least-once + consumer chống trùng) | Sequence diagram đăng ký/đặt vé có outbox trong `03` §3.5 |

Báo cáo cuối `08-phase2-results.md`: bảng yêu cầu phi chức năng ở trên, mỗi dòng ghi **đạt / không đạt** kèm số đo trước/sau.

---

## 1. Các mảng việc (workstream)

### WS0 — Đo lường & CI · cỡ M · người A

**Hiện trạng**
- `pom.xml` không có Actuator/Micrometer → không có metrics nào.
- Không có `.github/workflows` → bộ test có sẵn (~5.800 dòng, chạy trên PostgreSQL thật) không chạy tự động.
- `load-tests/scripts/post_booking_locust.py:16` chỉ cho mỗi chuyến 4 lượt đặt, dùng chung 1 JWT → chưa từng đo tranh chấp.

**Việc**
1. Thêm `spring-boot-starter-actuator`, `micrometer-registry-prometheus`; mở `/actuator/prometheus` (chỉ nội bộ).
2. `compose.observability.yaml`: Prometheus + Grafana + postgres_exporter; bật `log_lock_waits`.
3. `load-tests/scripts/hotspot_booking_locust.py`: N user (mỗi user JWT riêng) tranh 1 chuyến K ghế + script đối soát sau khi chạy (booking CONFIRMED = K, `available_seats` = 0).
4. `.github/workflows/ci.yml`: `./mvnw verify` với service PostgreSQL 16 (`TEST_DB_URL`).
5. Chạy baseline trên `baseline`, lưu vào `load-tests/results/baseline_hotspot/`.

**File sở hữu:** `pom.xml`, khối `management.*` trong `application.properties`, dòng actuator trong `SecurityConfig`, `compose.observability.yaml`, `load-tests/**`, `.github/**`.

**Xong khi:** dashboard có p95/p99, Hikari pending, lock wait; CI xanh; có bộ số baseline.

---

### WS1 — Luồng đặt vé: idempotency + tranh chấp · cỡ L · người B

**Hiện trạng**
- `BookingService.create` (dòng 28) sinh mã booking mới mỗi lần gọi → client retry sau timeout tạo booking thứ hai, trừ ghế hai lần.
- Đặt vé = `SELECT FOR UPDATE` → `UPDATE` có điều kiện → `INSERT`, giữ khóa trip suốt transaction.
- `create`/`cancel` không kiểm tra giờ khởi hành.
- `V16` xóa index `trips(route_id)`, `trips(vehicle_id)`; không có index `bookings(trip_id)`, `bookings(user_id)`, `trips(departure_time)`.

**Việc (theo thứ tự)**
1. Header `Idempotency-Key` cho `POST /api/bookings`: bảng `idempotency_keys(user_id, key, request_hash, booking_id, created_at)`, unique `(user_id, key)`, ghi cùng transaction. Cùng key khác body → 422.
2. Kiểm tra `departure_time > now()` khi đặt; chặn hủy sau mốc nhóm chốt (xem mục 5).
3. Thí nghiệm: gộp thành một câu `UPDATE trips ... WHERE available_seats >= :q AND status = 'SCHEDULED' AND departure_time > now() RETURNING price` (bỏ `SELECT FOR UPDATE`), giữ nguyên test chống oversell; so với baseline bằng kịch bản WS0.
4. Thêm index còn thiếu, kiểm chứng bằng `EXPLAIN ANALYZE` trên ~1 triệu dòng.

**File sở hữu:** `BookingService`, `BookingController`, `api/dto/booking/*`, `BookingRepository` (port + adapter), method `updateAvailableSeats` trong `SpringDataTripRepository`, migration `V17`, `V20`.

**Xong khi:** gửi trùng key (đồng thời và tuần tự) → 1 booking; đặt chuyến đã qua giờ → 4xx; bảng p99/throughput trước/sau.

---

### WS2 — Lịch chuyến & vòng đời chuyến · cỡ M · người C

**Hiện trạng**
- `TripService.create/update` (dòng 42, 50) không kiểm tra trùng lịch xe; DB cũng không có ràng buộc.
- Không có code nào chuyển chuyến sang `IN_PROGRESS`/`COMPLETED` (chỉ có trong enum) → chuyến đã chạy vẫn `SCHEDULED`, vẫn đặt được vé; xe có chuyến cũ bị coi là "đang chạy" mãi nên `VehicleService` chặn đổi sức chứa.
- `update()` cho đổi giờ/tuyến dù chuyến đã có booking.

**Việc**
1. Kiểm tra trùng lịch trong `TripService` **sau** bước khóa vehicle (`validate()` đã khóa sẵn → an toàn khi hai admin tạo cùng lúc).
2. Migration `V18`: `btree_gist` + `EXCLUDE USING gist (vehicle_id WITH =, tsrange(departure_time, arrival_time) WITH &&) WHERE (status <> 'CANCELLED')`.
3. Job `@Scheduled` chuyển `SCHEDULED → IN_PROGRESS → COMPLETED` theo giờ, dùng `UPDATE` có điều kiện để chạy an toàn trên nhiều instance.
4. Chặn đổi giờ/tuyến khi đã có booking CONFIRMED (hoặc cho đổi và phát sự kiện `TripChanged` sang WS3 — xem mục 5).

**File sở hữu:** `TripService`, job mới trong `business/service`, method mới trong `SpringDataTripRepository`, migration `V18`.

**Xong khi:** hai admin tạo chuyến trùng đồng thời → đúng 1 thành công; chuyến quá giờ tự đổi trạng thái; xe có chuyến đã hoàn thành đổi được sức chứa.

---

### WS3 — Outbox & thông báo · cỡ L · người D

**Hiện trạng**
- `EmailVerificationService.register` (dòng 38–39) commit DB rồi gọi SMTP đồng bộ ngay trong request → dual write.
- Đặt/hủy vé không gửi thông báo nào.

**Việc**
1. Migration `V19`: bảng `outbox_events(id, type, payload jsonb, status, attempts, next_attempt_at, created_at, sent_at)`.
2. Ghi OTP vào outbox cùng transaction với `createPending`; worker `@Scheduled` lấy lô bằng `FOR UPDATE SKIP LOCKED`, gửi, retry có backoff, giới hạn số lần thử.
3. Tạo port `OutboxPublisher` **sớm** để WS1 gọi khi booking CONFIRMED/CANCELLED → email xác nhận.
4. Relay outbox → RabbitMQ; tách consumer gửi email, chống trùng theo `event_id`. Đây là phần "message queue" mà Pha 1 để ngoài phạm vi.

**File sở hữu:** `EmailVerificationService`, `EmailVerificationConfig`, `notification/*`, `business/port/notification/OutboxPublisher`, migration `V19`, service `rabbitmq` trong `compose.yaml`.

**Xong khi:** tắt Mailpit hoặc RabbitMQ 2 phút rồi bật lại → mọi email đều đến, không trùng; latency `/api/auth/register` giảm (số từ WS0).

---

### WS4 — Chạy nhiều instance · cỡ M · người A

**Hiện trạng**
- `AuthRequestRateLimiter` dùng `HashMap` + `synchronized` trong RAM → mỗi instance một quota riêng.
- Chỉ tin `getRemoteAddr()` và `server.forward-headers-strategy=none` → sau Nginx mọi người dùng chung 1 quota (IP của Nginx).
- Khi đầy `maxKeys`, chặn **mọi** client mới (`AuthRequestRateLimiter.java:33-34`).

**Việc**
1. Rate limit qua Redis (Bucket4j hoặc Lua token bucket), bỏ cơ chế chặn toàn cục khi đầy key.
2. Chỉ tin `X-Forwarded-For` từ proxy tin cậy (Nginx).
3. `compose.scale.yaml`: Nginx + 3 backend + Redis + RabbitMQ (toàn bộ kiến trúc đích ở mục 0).
4. Chạy lại kịch bản hotspot của WS0 trên 3 instance.

**File sở hữu:** `security/ratelimit/*`, khối forward-headers/redis trong `application.properties`, `compose.scale.yaml`, `nginx/`.

**Xong khi:** quota đúng trên toàn cụm; 3 instance không bán quá ghế, không gửi email trùng; bảng throughput 1 vs 3 instance.

---

## 2. Phân công (4 người)

| Người | Mảng việc | Vai trò | Làm ở giai đoạn |
|---|---|---|---|
| **A** | WS0 + WS4 | Hạ tầng & đo lường: metrics, CI, kịch bản tải, Redis, Nginx, nhiều instance | WS0 ở giai đoạn 1, WS4 ở giai đoạn 2–3 |
| **B** | WS1 | Luồng đặt vé: idempotency, giờ khởi hành, thí nghiệm tranh chấp, index | 1–2 |
| **C** | WS2 | Lịch chuyến: chống trùng lịch xe, job trạng thái chuyến, chặn sửa chuyến đã bán vé | 1 (xong sớm thì nhận phần index `V20` của B) |
| **D** | WS3 | Outbox & thông báo: OTP qua outbox, RabbitMQ, email xác nhận đặt/hủy vé | 1–2 |

- A gộp WS0 + WS4 vì cùng làm hạ tầng (compose, Prometheus, Nginx) và hai phần rơi vào hai giai đoạn khác nhau.
- B và D nặng nhất (cỡ L); C nhẹ hơn nên đỡ B phần index nếu xong sớm.
- A cung cấp script tải và dashboard; B, D tự chạy và dán số liệu trước/sau vào PR.

## 3. Thứ tự và phụ thuộc

| Giai đoạn | Việc | Cần có trước |
|---|---|---|
| 1 | WS0 dựng metrics + kịch bản hotspot, đo baseline | — |
| 1 (song song) | WS1 idempotency + kiểm tra giờ · WS2 chống trùng lịch + job trạng thái · WS3 outbox cho OTP | — |
| 2 | WS1 thí nghiệm tranh chấp + index | Kịch bản và số baseline của WS0 |
| 2 | WS3 nối sự kiện booking | WS1 đã merge |
| 2 | WS4 Redis rate limit + compose.scale | Hạ tầng WS0 |
| 3 | WS4 kiểm chứng tổng trên 3 instance; cả nhóm chạy lại toàn bộ benchmark so với `baseline` | WS1–WS3 đã merge |

## 4. Quy ước tránh conflict

- **Branch:** `feat/ws0-observability`, `feat/ws1-booking`, `feat/ws2-trip-schedule`, `feat/ws3-outbox`, `feat/ws4-scale-out`.
- **Số migration đặt trước:** `V17` WS1 idempotency · `V18` WS2 chống trùng lịch · `V19` WS3 outbox · `V20` WS1 index. Merge theo đúng thứ tự số; nếu DB dev báo lỗi Flyway thì xóa volume rồi chạy lại.
- **File dùng chung:**
  - `SpringDataTripRepository`: WS1 và WS2 chỉ **thêm method mới**, không sửa method của nhau.
  - `BookingService`: chỉ WS1 sửa; WS3 đưa interface `OutboxPublisher` để WS1 gọi.
  - `application.properties`: mỗi WS thêm khối riêng, có comment `# WSx`.
- **Test:** viết class test mới, không sửa test cũ trừ khi hành vi đổi có chủ đích.
- **PR:** CI phải xanh; PR của WS1, WS3, WS4 kèm số liệu trước/sau.

## 5. Cần chốt trước khi code

1. Hủy vé chậm nhất bao lâu trước giờ khởi hành? (WS1)
2. Chuyến đã có booking: cấm đổi giờ/tuyến, hay cho đổi và gửi thông báo? (WS2, WS3)
3. Kịch bản hotspot: bao nhiêu user, bao nhiêu ghế, chạy bao lâu? (WS0) — gợi ý 500 và 1.000 user, 40 ghế.

## 6. Ngoài phạm vi

- Không làm: microservices, Kafka, Kubernetes, dùng Redis làm nơi giữ số ghế (PostgreSQL vẫn quyết định cuối cùng).
- Chỉ làm nếu còn thời gian: giữ ghế có hạn (`HELD → CONFIRMED/EXPIRED`), cache tìm chuyến bằng Redis.
