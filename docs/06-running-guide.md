# 6. Hướng dẫn chạy


## 6.1. Các thành phần cần chạy

- **Spring Boot backend:** REST API, mặc định ở `http://localhost:8085` khi chạy local với cấu hình hiện dùng.
- **PostgreSQL:** lưu tài khoản, danh mục, chuyến xe và booking; **Flyway** thực thi/kiểm tra migration khi ứng dụng khởi động.
- **SMTP:** dùng để gửi mã xác thực email (OTP). Có thể dùng **Mailpit** để kiểm tra email trong môi trường phát triển.
- **Swagger/OpenAPI:** thử các endpoint; trong Pha 1 hệ thống có **32 REST API** theo phạm vi đã chốt.

## 6.2. Yêu cầu môi trường

| Công cụ | Yêu cầu / ghi chú |
|---|---|
| Git | Clone source từ GitHub |
| Docker Desktop + Docker Compose | Cách chạy ưu tiên; bật Linux containers |
| JDK 21 | Cần khi build/chạy backend trực tiếp trên Windows |
| Maven | **Không cần cài riêng** nếu dùng Maven Wrapper (`mvnw.cmd`) |
| PostgreSQL | Có thể chạy bằng Docker; không cần cài trên Windows nếu Compose đã cung cấp database |

Kiểm tra nhanh:

```powershell
java -version
.\mvnw.cmd -v
docker version
docker compose version
```

## 6.3. Chuẩn bị cấu hình

1. Clone repository, mở PowerShell ở thư mục `busbooking/`.
2. Kiểm tra `compose.yaml`, `.env.example` và `src/main/resources/application*.properties` trước khi chạy.
3. Nếu Compose sử dụng `.env`, sao chép mẫu và **tự điền các giá trị còn thiếu**, không đưa mật khẩu/secret thật lên GitHub:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

   Chỉ dùng lệnh này khi `.env.example` có tồn tại; `.env` là cấu hình cá nhân và phải được `.gitignore` loại trừ.
4. Đảm bảo secret JWT và OTP **khác nhau**, là chuỗi Base64 giải mã ra **ít nhất 32 byte**. Với cấu hình đã được dùng trước đây, các biến quan trọng gồm:

   | Nhóm | Biến tiêu biểu |
   |---|---|
   | Database | `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` |
   | JWT | `JWT_SECRET`, `JWT_EXPIRATION_MS`, `JWT_ISSUER` |
   | OTP | `EMAIL_OTP_SECRET` |
   | SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_AUTH`, `SMTP_STARTTLS`; profile `dev` cố định host `localhost`, dùng `SPRING_MAIL_HOST` để override host |
   | Docs / môi trường | `SPRING_PROFILES_ACTIVE`, `API_DOCS_ENABLED` |

   **Chú ý:** `.env.example` hiện ghi DB ở `5433/busbooking`, khác Compose (`5435/busbooking_dev_fresh`); dùng đúng URL của môi trường thực tế. Spring Boot chạy **trực tiếp bằng Maven không tự đọc `.env`**; Compose chỉ chuyển các biến đã khai báo trong `environment` vào backend, không tự chuyển mọi biến trong `.env`.

## 6.4. Cách 1: Chạy bằng Docker Compose (khuyến nghị)

**Bước 1.** Kiểm tra Compose hợp lệ và xem tên service thực tế: `compose.yaml` có `postgres`, `backend`, `mailpit`; PostgreSQL publish `5435:5432`, backend `8086:8085`, Mailpit UI `8026:8025`; SMTP 1025 chỉ dùng trong Docker network.

```powershell
docker compose config --quiet
docker compose config --services
```

Nếu repository chưa có `compose.yaml` hoặc lệnh kiểm tra báo lỗi, **không tiếp tục với lệnh khởi chạy**; kiểm tra lại bản bàn giao và cấu hình cần thiết.

**Bước 2.** Build và khởi động các service được định nghĩa trong Compose. **Hạn chế hiện tại:** backend bật `dev`, đặt `SMTP_HOST=mailpit`, nhưng `application-dev.properties` cố định `spring.mail.host=localhost`. Cần override `SPRING_MAIL_HOST=mailpit` trong môi trường backend để dùng Mailpit qua network; chỉ thêm biến này vào `.env` chưa đủ vì Compose chưa chuyển nó vào container. Cấu hình hiện tại chưa sửa và luồng OTP qua Compose chưa được xác minh hoạt động:

```powershell
docker compose up -d --build
docker compose ps
```

**Bước 3.** Xem log khởi động để kiểm tra kết nối database và Flyway:

```powershell
docker compose logs --tail=100
docker compose logs -f
```

Thoát chế độ xem log bằng `Ctrl+C` (không dừng container).

**Bước 4.** Mở Swagger tại `http://localhost:8086/swagger-ui/index.html`, Mailpit UI tại `http://localhost:8026`; đối chiếu **cổng host trong `docker compose ps`** nếu môi trường đã đổi cổng. Việc backend trả HTTP không xác nhận luồng OTP hoạt động khi còn hạn chế SMTP nêu trên.

**Dừng hệ thống** (không xóa database volume):

```powershell
docker compose down
```

> **Không dùng `docker compose down -v`** khi muốn giữ dữ liệu. Compose hiện có backend service; khi dùng cách 2 để chạy Java local, dừng backend Compose nếu đang chạy (`docker compose stop backend`), chỉ khởi động `postgres` và dùng SMTP truy cập được từ host theo mục 6.5.

## 6.5. Cách 2: Chạy Spring Boot trực tiếp trên Windows

Dùng cách này khi cần debug backend bằng VS Code/IntelliJ hoặc khi Compose chỉ chạy các dịch vụ phụ trợ.

**Bước 1.** Khởi động PostgreSQL (có thể dùng `docker compose up -d postgres`) và SMTP thử nghiệm trước; kiểm tra host/port đang publish:

```powershell
docker ps
```

Mailpit trong Compose không publish SMTP 1025 ra host, nên backend local không dùng được cổng đó của service này. Có thể chạy **một container Mailpit riêng** cho backend local, miễn là cổng 1025/8025 chưa bị chiếm:

```powershell
docker run -d --name busbooking-auth-mailpit `
  -p 127.0.0.1:1025:1025 `
  -p 127.0.0.1:8025:8025 `
  axllent/mailpit:v1.27.8
```

Mailpit UI: `http://localhost:8025`. Nếu container đã tồn tại, dùng `docker start busbooking-auth-mailpit` thay vì `docker run` lần nữa.

**Bước 2.** Khai báo biến môi trường cho tiến trình PowerShell. Ví dụ dưới dùng PostgreSQL của `compose.yaml` tại `5435/busbooking_dev_fresh`; nếu tự tạo database khác, thay cả cổng và tên DB theo môi trường thực tế. Cung cấp mật khẩu/secret **của môi trường phát triển**, không đưa chúng vào source code:

```powershell
$env:SPRING_PROFILES_ACTIVE = "dev"
$env:DB_URL = "jdbc:postgresql://localhost:5435/busbooking_dev_fresh"
$env:DB_USERNAME = "busbooking_user"
$env:DB_PASSWORD = Read-Host "Mật khẩu PostgreSQL dev"

# Tạo hai secret độc lập dùng trong phiên demo.
# Giữ giá trị ổn định nếu muốn JWT/OTP còn hiệu lực sau restart.
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$jwtBytes = New-Object byte[] 32
$otpBytes = New-Object byte[] 32
$rng.GetBytes($jwtBytes)
$rng.GetBytes($otpBytes)
$env:JWT_SECRET = [Convert]::ToBase64String($jwtBytes)
$env:EMAIL_OTP_SECRET = [Convert]::ToBase64String($otpBytes)
$rng.Dispose()
$env:JWT_ISSUER = "busbooking"
$env:JWT_EXPIRATION_MS = "86400000"

$env:SPRING_MAIL_HOST = "127.0.0.1" # Override host cố định của profile dev
$env:SMTP_PORT = "1025"
$env:SMTP_AUTH = "false"
$env:SMTP_STARTTLS = "false"
$env:SMTP_FROM = "noreply@example.com"
$env:API_DOCS_ENABLED = "true"
$env:BOOTSTRAP_SUPER_ADMIN_ENABLED = "false"
```

**Bước 3.** Build và chạy. Với DB mới chưa có quản trị viên, trước khi chạy hãy đặt `$env:BOOTSTRAP_SUPER_ADMIN_ENABLED = "true"` thay giá trị `false` ở trên và khai báo `BOOTSTRAP_SUPER_ADMIN_EMAIL`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD`, `BOOTSTRAP_SUPER_ADMIN_FULL_NAME`, `BOOTSTRAP_SUPER_ADMIN_PHONE` trong cùng phiên PowerShell. Bootstrap chỉ cho profile `dev`/`test`, tạo tài khoản mới chưa xác minh, không nâng quyền/reset tài khoản cũ hoặc thay SUPER_ADMIN khác. Xác minh OTP qua Mailpit trước khi login; sau khởi tạo đặt lại flag `false`. Compose hiện cố định flag `false` và chưa chuyển bốn biến tài khoản, nên quy trình này áp dụng cho backend local:

```powershell
.\mvnw.cmd -DskipTests clean package
.\mvnw.cmd spring-boot:run
```

Ứng dụng sử dụng cấu hình `dev` trong phiên PowerShell trên. Khi chạy bằng IDE, cần khai báo **cùng các biến môi trường** trong Run Configuration. Nếu PostgreSQL/SMTP chạy **trong container** và backend cũng chạy **trong container**, không dùng `localhost` để kết nối container khác; thay bằng hostname/service tương ứng của Docker network.

## 6.6. Kiểm tra sau khi khởi chạy

Với backend local cổng 8085 hoặc Compose publish 8086, khi tài liệu API được bật:

| Thành phần | URL |
|---|---|
| Swagger UI | http://localhost:8085/swagger-ui/index.html (local); http://localhost:8086/swagger-ui/index.html (Compose) |
| OpenAPI JSON | http://localhost:8085/v3/api-docs (local); http://localhost:8086/v3/api-docs (Compose) |
| Base API | http://localhost:8085/api (local); http://localhost:8086/api (Compose) |
| Mailpit (nếu có) | http://localhost:8025 (container riêng cho local); http://localhost:8026 (Compose) |

Kiểm tra HTTP và xuất đặc tả API từ **ứng dụng đang chạy**:

```powershell
Invoke-WebRequest http://localhost:8085/v3/api-docs `
  -OutFile docs/openapi.json
```

Swagger có thể bị tắt ngoài profile `dev`/`test` nếu chưa bật `API_DOCS_ENABLED`; **404 từ Swagger không đồng nghĩa backend bị lỗi**.

**Luồng kiểm tra chức năng tối thiểu:**

1. `POST /api/auth/register` — đăng ký một email thử nghiệm; chưa nhận JWT.
2. Mở Mailpit hoặc hộp thư đã cấu hình để lấy OTP; gọi `POST /api/auth/verify-email`.
3. `POST /api/auth/login` — nhận JWT, dùng Swagger **Authorize** với Bearer token.
4. `GET /api/auth/me`, `GET /api/locations`, `GET /api/trips` — kiểm tra xác thực và dữ liệu công khai.
5. `POST /api/bookings` — tạo booking cho chuyến còn ghế; kiểm tra xem/hủy booking theo quyền.
6. Dùng tài khoản có quyền phù hợp để thử API quản trị; `USER` không được truy cập endpoint chỉ dành cho `ADMIN`/`SUPER_ADMIN`.

Chi tiết request/response, quyền và 32 endpoint: [`04-api-design.md`](04-api-design.md). `docs/openapi.json` hiện còn lỗi response/validation và chứa `/error` nội bộ; chỉ xuất lại JSON không bảo đảm các lỗi đặc tả đã được sửa.

## 6.7. Kiểm thử và benchmark

```powershell
# Chạy các bài kiểm thử Maven; cần môi trường test và database test độc lập
.\mvnw.cmd test

# Build JAR để đóng gói/bàn giao
.\mvnw.cmd -DskipTests clean package
```

**Không trỏ integration test vào database development có dữ liệu cần giữ.** Kiểm tra `application-test.properties`, `TEST_DB_URL` và các biến liên quan trước khi chạy test. Lệnh `test` mặc định chưa bao gồm các class `*SmokeIT`; có thể chạy riêng bằng `.\mvnw.cmd "-Dtest=AuthLiveHttpSmokeIT,SuperAdminLiveHttpSmokeIT,SmtpMailpitSmokeIT" test` khi database test và Mailpit sẵn sàng. Kết quả build/test mới nhất chưa được xác minh trong lần đối chiếu tài liệu.

Baseline hiệu năng GET Trip / POST Booking Pha 1 trên Kaggle CPU, script Locust, dữ liệu giả lập và kết quả nằm ở [`../load-tests/`](../load-tests/). Bài benchmark Kaggle chạy Java + PostgreSQL + Locust trong notebook, **không yêu cầu Docker bên trong Kaggle**.

## 6.8. Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra / xử lý |
|---|---|
| `Connection refused` PostgreSQL | `docker compose ps` hoặc `docker ps`; kiểm tra đúng **cổng host**, database, user, password và network |
| Flyway checksum mismatch / missing table | Đối chiếu migration **V1–V16** với lịch sử DB; **không tự ý sửa migration cũ, tắt validation hoặc chạy `flyway repair`** để che lỗi |
| Backend không lên vì JWT/OTP secret | Kiểm tra hai secret Base64 khác nhau, tối thiểu 32 byte sau giải mã |
| Không nhận OTP | Kiểm tra SMTP và Mailpit; profile `dev` cố định host `localhost`, cần `SPRING_MAIL_HOST` để override. Compose chưa chuyển biến này; backend local cần SMTP publish ra host |
| Swagger trả 404 | Kiểm tra profile `dev`, `API_DOCS_ENABLED` và cổng publish backend |
| HTTP `401` / `403` | Kiểm tra JWT, trạng thái xác minh email, role và ownership; đây có thể là phản hồi phân quyền đúng |
| HTTP `429` khi thử auth | Rate limit đăng ký/đăng nhập/OTP; chờ hết cửa sổ giới hạn thay vì gọi liên tục |
| Port 8085/8086/5435/1025/8025/8026 bị chiếm | Dùng `docker ps`, `Get-NetTCPConnection -State Listen`; điều chỉnh cổng phù hợp trong cấu hình |
| Chạy Java trong container không kết nối được DB | JDBC URL không được dùng `localhost` để chỉ container PostgreSQL khác; dùng tên service/network thực tế |

