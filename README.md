# Bus Booking System - Nền tảng đặt vé xe khách trực tuyến

## 1. Tổng quan đề tài

### 1.1. Bối cảnh

Hiện nay, nhu cầu di chuyển bằng xe khách giữa các tỉnh, thành phố ngày càng phổ biến. Người dùng thường phải tìm kiếm thông tin chuyến xe, thời gian khởi hành, giá vé và số ghế còn trống thông qua nhiều nguồn khác nhau. Việc đặt vé theo phương thức thủ công (phương thức truyền thống) có thể gây mất thời gian và khó quản lý thông tin đặt vé.

Bên cạnh đó, các nhà xe cần quản lý nhiều thông tin liên quan đến phương tiện, tuyến đường, lịch trình và vé đã được đặt. Nếu quản lý bằng phương thức thủ công, việc cập nhật số lượng ghế còn trống và theo dõi các lượt đặt vé có thể dễ xảy ra sai sót.

Vì vậy, hệ thống quản lý đặt vé xe khách trực tuyến được xây dựng nhằm cung cấp một nền tảng tập trung để người dùng tìm kiếm chuyến xe và thực hiện đặt vé, đồng thời hỗ trợ quản trị viên quản lý các dữ liệu cơ bản của hệ thống.

### 1.2. Vấn đề

Hệ thống tập trung giải quyết các vấn đề chính sau:

* Người dùng khó tìm kiếm và so sánh các chuyến xe phù hợp với nhu cầu di chuyển.
* Thông tin về tuyến đường, thời gian khởi hành, giá vé và số ghế còn trống cần được quản lý tập trung.
* Việc đặt vé thủ công gây khó khăn trong việc quản lý thông tin hành khách và số lượng vé.
* Số lượng ghế còn trống cần được cập nhật sau khi có booking.
* Người dùng cần có khả năng theo dõi các booking đã thực hiện.
* Quản trị viên cần có khả năng quản lý dữ liệu của hệ thống.

## 2. Chức năng và phạm vi pha 1

| Đối tượng | Chức năng chính |
|---|---|
| **Khách** | Tìm kiếm/xem chuyến xe, xem địa điểm, đăng ký và xác minh email bằng OTP |
| **USER** | Đăng nhập, cập nhật hồ sơ, đặt vé, xem lịch sử và hủy booking của mình |
| **ADMIN** | Quản lý nhà xe, phương tiện, địa điểm, tuyến đường, chuyến xe và tra cứu booking |
| **SUPER_ADMIN** | Có quyền của ADMIN và được nâng/hạ vai trò `USER` ↔ `ADMIN` |


## 3. Kiến trúc, công nghệ và tổ chức mã nguồn

BusBooking là **modular monolith**, kết hợp **Layered Architecture** với **Ports và Adapters**. Controller tiếp nhận HTTP; Business xử lý nghiệp vụ qua các interface (*ports*); adapter hiện thực truy cập dữ liệu, bảo mật và gửi email.

```mermaid
flowchart LR
    Client[Client / Postman] --> Security[Spring Security]
    Security --> API[Controller / DTO]
    API --> Business[Business Services]
    Business --> Domain[Domain]
    Business --> Ports[Outbound Ports]
    Adapter[Infrastructure Adapters] -.->|implements| Ports
    Adapter --> DB[(PostgreSQL)]
    Adapter --> SMTP[SMTP / Mailpit]
```

```text
src/main/java/com/example/busbooking/
├── api/           # Controllers, DTOs, mappers, validation
├── business/      # Services, commands, ports, results
├── domain/        # Models, enums, business exceptions
├── data/          # JPA entities, repositories, adapters, mappers
├── security/      # JWT, BCrypt, HMAC OTP, rate limiting
├── notification/  # SMTP email adapter
├── config/        # Cấu hình ứng dụng
└── exception/     # Chuẩn hóa lỗi HTTP
```

| Thành phần | Công nghệ và cách sử dụng |
|---|---|
| Backend | **Java 21, Spring Boot**, build/chạy bằng Maven Wrapper |
| Database | **PostgreSQL + Spring Data JPA**; **Flyway V1–V16** quản lý phiên bản schema |
| Bảo mật | **Spring Security, JWT, BCrypt**, email OTP; phân quyền theo vai trò |
| Tích hợp | **SMTP** gửi OTP; **Mailpit** hỗ trợ kiểm tra email khi phát triển |
| API và kiểm thử | REST/JSON, Springdoc OpenAPI/Swagger, JUnit, Mockito, Locust |
| Môi trường | Có thể dùng Docker cho PostgreSQL/Mailpit; cách chạy container phụ thuộc cấu hình repository |

## 4. Cấu hình và chạy nhanh (có thể xem chi tiết tại [Running Guide](docs/06-running-guide.md))

**Cần có:** JDK 21, PostgreSQL, SMTP (có thể dùng Mailpit) và source code chứa `pom.xml`, `mvnw.cmd`.

1. Chuẩn bị database PostgreSQL và SMTP; xác nhận địa chỉ/cổng đang sử dụng.
2. Cấu hình biến môi trường `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `JWT_SECRET`, `EMAIL_OTP_SECRET` và `SMTP_*` theo [Running Guide](docs/06-running-guide.md). Hai secret phải độc lập; **Spring Boot chạy trực tiếp không tự đọc `.env`**.
3. Từ thư mục gốc repository, chạy:

   ```powershell
   $env:SPRING_PROFILES_ACTIVE = "dev"
   .\mvnw.cmd spring-boot:run
   ```

Khi kết nối database thành công, **Flyway kiểm tra/áp dụng các migration** khi ứng dụng khởi động. Với cấu hình local cổng `8085`, mở [Swagger UI](http://localhost:8085/swagger-ui/index.html) để thử API. Repository có `compose.yaml` cho PostgreSQL, backend và Mailpit; backend publish cổng `8086`. Xem cổng, bootstrap và hạn chế SMTP của profile `dev` tại [Running Guide](docs/06-running-guide.md).

## 5. API và kiểm thử

- Tài liệu api đầy đủ: [thiết kế API](docs/04-api-design.md); Swagger cung cấp đặc tả tại `http://localhost:8085/v3/api-docs` khi backend chạy và docs được bật.
- **File api json:** [api json file](docs/openapi.json)

- **Kiểm thử tự động:** JUnit/Mockito và integration test; chạy `.\mvnw.cmd test` sau khi cấu hình **database test riêng** như Running Guide.
- **Load test Pha 1 (Kaggle CPU, Locust):** tại 20 người dùng ảo, snapshot CSV ghi GET **2.834 request / 48,01 RPS**, POST **2.789 / 47,21 RPS**; console cuối lượt ghi tương ứng **2.864 / 48,05 RPS** và **2.816 / 47,16 RPS**. Cả hai nguồn ghi 0 lỗi; nguyên nhân chênh lệch và mốc thống kê chuẩn **chưa xác minh**. Đây là *baseline thử nghiệm*, không phải giới hạn hiệu năng của hệ thống. Xem [kết quả kiểm thử tải](load-tests/README.md).

## 6. Tài liệu chi tiết và bàn giao Pha 2

| Tài liệu | Nội dung |
|---|---|
| [1 Tổng quan và yêu cầu hệ thống](docs/01-overview-and-requirements.md) | Yêu cầu, actors, nghiệp vụ |
| [2 Thiết kế database](docs/02-database-design.md) | ERD, ràng buộc, Flyway migrations |
| [3 Kiến trúc hệ thống (pha 1)](docs/03-system-architecture.md) | Thành phần, kiến trúc và hướng phụ thuộc |
| [4 Thiết kế API](docs/04-api-design.md) | Các API, phân quyền và hợp đồng |
| [5 Tổ chức mã nguồn](docs/05-source-code-design.md) | Tổ chức packages, services, ports và adapters |
| [6 Hướng dẫn chạy](docs/06-running-guide.md) | Cấu hình, khởi chạy, kiểm tra và xử lý lỗi |
| [7 Kết quả kiểm thử tải](load-tests/README.md) | Kết quả baseline Locust, CSV và console |
| [8 Hướng dẫn kiểm thử tải](load-tests/scripts/load_testing.md) | Hướng dẫn chạy Locust, tạo fixture và phân tích kết quả |


> **Lưu ý:** Không commit `.env`, mật khẩu, JWT/OTP secret hay dữ liệu cá nhân thật. Khi thay đổi database, tạo migration Flyway mới thay vì sửa migration đã áp dụng.

### Gợi ý cải tiến cho Pha 2

- **PostgreSQL và tìm kiếm chuyến xe:** Truy vấn hiện trả về toàn bộ danh sách, còn một số index tăng tốc đã được hoãn ở V16; nên phân tích bằng `EXPLAIN ANALYZE` trên dữ liệu đại diện để chọn index phù hợp và bổ sung phân trang.
- **Booking đồng thời:** Pha 1 đã có transaction, khóa bi quan và cập nhật ghế có điều kiện; khi tải lớn, cần đo thời gian chờ khóa để tối ưu thời gian giữ khóa, timeout và connection pool. Cân nhắc cơ chế idempotency để tránh tạo booking lặp khi client gửi lại yêu cầu.
- **Redis Cache cho API đọc:** Các lượt đọc lặp lại có thể làm tăng tải PostgreSQL; cân nhắc cache địa điểm và kết quả tìm chuyến với TTL, cơ chế vô hiệu hóa khi dữ liệu thay đổi. Số ghế khi đặt vé vẫn phải được kiểm tra và cập nhật tại database trong transaction.
- **Monitoring và logging:** Bổ sung metric độ trễ API, lỗi, connection pool và thời gian chờ khóa để hỗ trợ phát hiện điểm nghẽn. Chuẩn hóa log có mã liên kết request và cảnh báo, đồng thời che thông tin nhạy cảm.
- **Mở rộng, Docker và CI/CD:** Trên nền Dockerfile/Compose hiện có, chuẩn hóa cấu hình triển khai, bổ sung health check cho backend và pipeline kiểm thử, build image, triển khai. Trước khi chạy nhiều backend instance, cần đưa bộ đếm rate limit đang lưu trong bộ nhớ sang cơ chế dùng chung.
- **Kiểm thử tải và bảo mật:** Mở rộng baseline Locust bằng dữ liệu lớn hơn, nhiều tài khoản, tải hỗn hợp đọc/ghi và tranh chấp trên cùng chuyến, kết hợp kiểm tra tính nhất quán ghế. Bổ sung kiểm thử bảo mật tự động và quét dependency để mở rộng độ bao phủ cho JWT, OTP, phân quyền và rate limit đã có.
