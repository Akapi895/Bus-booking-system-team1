# 5. Tổ chức mã nguồn

## 5.1. Tổng quan

BusBooking là một ứng dụng backend Java 21/Spring Boot cung cấp REST API với dữ liệu PostgreSQL. Mã nguồn áp dụng **Kiến trúc phân lớp kết hợp Ports và Adapters**: tầng API tiếp nhận HTTP; tầng Business triển khai use case; tầng Domain định nghĩa khái niệm nghiệp vụ; adapter hạ tầng đảm nhiệm lưu trữ, bảo mật và gửi email.

Ứng dụng hiện tổ chức thành **một backend duy nhất với các package nghiệp vụ**, không phải hệ thống microservices. Các thành phần nổi bật gồm:

- **REST API:** controller, DTO, mapper và validation đầu vào.
- **Business:** service, command/result và các port (interface).
- **Domain:** model, enum trạng thái và exception nghiệp vụ.
- **Persistence:** JPA entity, Spring Data repository, repository adapter và persistence mapper; adapter OTP/quản lý role còn dùng `JdbcTemplate`.
- **Security/Notification:** JWT, BCrypt, HMAC cho OTP, xác thực email qua SMTP, giới hạn tần suất request.
- **Cross-cutting:** cấu hình bean/OpenAPI, xử lý lỗi HTTP, Flyway migration và test.

Mục tiêu thiết kế là tách trách nhiệm, giới hạn sự phụ thuộc của nghiệp vụ vào HTTP/JPA và cho phép kiểm thử các use case qua interface.

## 5.2. Cấu trúc mã nguồn

Package gốc: `com.example.busbooking`.

```text
src/
├── main/
│   ├── java/com/example/busbooking/
│   │   ├── BusBookingApplication.java
│   │   ├── api/
│   │   │   ├── controller/
│   │   │   ├── dto/            # auth, booking, location, operator, route, trip, user, vehicle
│   │   │   ├── mapper/
│   │   │   └── validation/
│   │   ├── business/
│   │   │   ├── command/
│   │   │   ├── port/
│   │   │   │   ├── notification/
│   │   │   │   ├── repository/
│   │   │   │   └── security/
│   │   │   ├── result/
│   │   │   └── service/
│   │   ├── domain/
│   │   │   ├── enums/
│   │   │   ├── exception/
│   │   │   └── model/
│   │   ├── data/
│   │   │   ├── adapter/
│   │   │   ├── entity/
│   │   │   ├── mapper/
│   │   │   └── repository/
│   │   ├── security/
│   │   │   └── ratelimit/
│   │   ├── notification/
│   │   ├── config/
│   │   └── exception/
│   └── resources/
│       ├── application.properties
│       ├── application-dev.properties
│       ├── application-test.properties
│       └── db/migration/       # Flyway V1–V16
└── test/java/com/example/busbooking/
    ├── api/
    ├── business/
    ├── config/
    ├── data/
    ├── integration/
    ├── notification/
    └── security/
```

**Lưu ý về tên lớp:** Trong source hiện tại dùng `Operator`/`OperatorEntity`, **không** dùng `BusOperator`/`BusOperatorEntity` như cây thiết kế cũ. Cũng **không có** `AdminController` hoặc `AdminService` tổng hợp; API quản trị được chia thành nhiều controller, còn logic nằm ở các service theo nghiệp vụ.

## 5.3. API Layer - `api/`

### Controller

Controller nhận request, kích hoạt validation, chuyển DTO sang kiểu dữ liệu phù hợp, gọi service và trả về HTTP response. Danh sách controller trong cây source:

| Nhóm | Controller |
|---|---|
| Xác thực và tài khoản | `AuthController`, `UserController`, `RoleManagementController` |
| Truy vấn công khai/đặt vé | `LocationController`, `TripController`, `BookingController` |
| Quản trị dữ liệu | `AdminLocationController`, `AdminOperatorController`, `AdminVehicleController`, `AdminRouteController` |
| Quản trị chuyến/đặt vé | `AdminTripController`, `AdminBookingController` |

Controller **không nên** thực hiện truy vấn JPA trực tiếp hoặc chứa logic quan trọng như trừ/hoàn ghế. Bộ endpoint thực tế được công bố qua OpenAPI/Swagger; tên controller không đồng nghĩa với số lượng endpoint.

### DTO, mapper và validation

- `api/dto/`: request/response theo nhóm `auth`, `user`, `location`, `operator`, `vehicle`, `route`, `trip`, `booking`.
- `api/mapper/`: ánh xạ dữ liệu giữa DTO và domain/use-case, ví dụ `BookingDtoMapper`, `TripDtoMapper`, `AuthDtoMapper`.
- `api/validation/`: có `AuthField` và `AuthFieldValidator` phục vụ ràng buộc đầu vào của API.

DTO giới hạn những trường có thể nhận/trả, tránh trả thẳng JPA entity hoặc dữ liệu bảo mật như hash mật khẩu, OTP và token ngoài các response được phép.

## 5.4. Business Layer - `business/`

### Service và use case

Các service hiện diện trong cây source:

| Nhóm chức năng | Class tiêu biểu |
|---|---|
| Xác thực, tài khoản | `AuthService`, `EmailVerificationService`, `UserService`, `RoleManagementService`, `BootstrapSuperAdminService` |
| Danh mục vận hành | `LocationService`, `OperatorService`, `VehicleService`, `RouteService` |
| Chuyến xe và đặt vé | `TripService`, `BookingService` |
| Chính sách đầu vào | `AuthInputPolicy`, `OperatorInputPolicy` |

`business/command` chứa các thông điệp đầu vào use case như `RegisterCommand`, `VerifyEmailCommand`, `SaveTripCommand`, `SaveVehicleCommand`; `business/result` có `LoginResult`, `IssuedToken`, `AuthenticatedUser`. Những kiểu này giúp hạn chế việc truyền HTTP DTO vào sâu trong nghiệp vụ.

### Outbound Ports

`business/port` định nghĩa **hợp đồng** cho các dịch vụ ở ngoài tầng Business:

| Nhóm port | Interface tiêu biểu | Adapter/hạ tầng liên quan |
|---|---|---|
| Repository | `BookingRepository`, `TripRepository`, `UserRepository`, `OperatorRepository`, `EmailVerificationRepository`, `RoleManagementRepository` | Các lớp tại `data/adapter/` |
| Security | `PasswordHasher`, `TokenProvider`, `VerificationCodeProvider` | `BCryptPasswordHasher`, `JwtService`, `HmacVerificationCodeProvider` |
| Notification | `EmailVerificationSender` | `SmtpEmailVerificationSender` |

Các repository port khác gồm `LocationRepository`, `RouteRepository`, `VehicleRepository`, `RoleRepository`. Không nhầm các **business repository port** với interface **Spring Data repository** tại `data/repository`.

## 5.5. Domain Layer - `domain/`

- `domain/model`: `User`, `Role`, `Operator`, `Location`, `Vehicle`, `Route`, `Trip`, `Booking`; có thêm kiểu tổng hợp như `OperatorSummary`, `VehicleSummary`, `RouteSummary`.
- `domain/enums`: `RoleName`, `UserStatus`, `OperatorStatus`, `VehicleStatus`, `RouteStatus`, `TripStatus`, `BookingStatus`.
- `domain/exception`: biểu diễn lỗi nghiệp vụ như `InsufficientSeatsException`, `ForbiddenOperationException`, `TripConflictException`, `DuplicateLocationException`, `OperatorInUseException` và các ngoại lệ chuyên biệt khác.

Domain model **không đồng nhất** với `data/entity`: model biểu diễn khái niệm nghiệp vụ; entity phục vụ ánh xạ dữ liệu JPA. Danh sách đầy đủ giá trị enum và ràng buộc DB phải lấy từ source và migration hiện hành, không dùng các giá trị “dự kiến” trong tài liệu cũ.

## 5.6. Data Access Layer - `data/`

Tầng dữ liệu tách bốn nhiệm vụ:

| Package | Vai trò | Ví dụ |
|---|---|---|
| `data/entity` | Ánh xạ bảng PostgreSQL qua JPA | `BookingEntity`, `TripEntity`, `OperatorEntity`, `UserEntity` |
| `data/repository` | Interface truy cập JPA | `SpringDataBookingRepository`, `SpringDataTripRepository` |
| `data/adapter` | Hiện thực business repository port bằng JPA hoặc JDBC | `BookingRepositoryAdapter`, `TripRepositoryAdapter`, `BusOperatorRepositoryAdapter`; `EmailVerificationRepositoryAdapter`/`RoleManagementRepositoryAdapter` dùng `JdbcTemplate` |
| `data/mapper` | Chuyển đổi domain ↔ persistence entity | `BookingPersistenceMapper`, `TripPersistenceMapper`, `OperatorPersistenceMapper` |

Ví dụ đường đi của dữ liệu đặt vé:

```mermaid
flowchart TD
    A["BookingService"]
    B["business.port.repository.BookingRepository"]
    C["data.adapter.BookingRepositoryAdapter"]
    D["data.repository.SpringDataBookingRepository"]
    E["data.mapper.BookingPersistenceMapper"]
    F["data.entity.BookingEntity"]
    G[("PostgreSQL")]

    A -->|"Gọi interface"| B
    C -.->|"implements"| B

    C --> D
    C --> E

    D --> F
    E <-->|"Mapping"| F
    D -->|"Spring Data JPA"| G
```

**Tên đáng lưu ý:** Port nghiệp vụ là `OperatorRepository`, trong khi adapter lưu trữ thực tế mang tên `BusOperatorRepositoryAdapter` và JPA interface là `SpringDataBusOperatorRepository`. Đây là khác biệt cách đặt tên, không phải ba module nghiệp vụ độc lập.

Cấu trúc trên cho phép các use case làm việc với abstraction mà không tham chiếu trực tiếp `JpaRepository`. Nhánh OTP/role dùng JDBC, không đi qua Spring Data repository; `email_verifications` không có JPA Entity riêng. Transaction OTP/role nằm ở adapter, còn giao dịch thay đổi Booking/Trip nằm ở service; SMTP chạy sau khi tài khoản/challenge đã commit.

## 5.7. Security và Notification

### Security — `security/`

| Thành phần | Mục đích |
|---|---|
| `SecurityConfig` | Cấu hình các quy tắc bảo vệ request |
| `JwtAuthenticationFilter`, `JwtService`, `JwtProperties` | Đọc và xác minh JWT, cung cấp thông tin token |
| `CurrentUserLoader`, `AuthenticatedPrincipal` | Nạp và biểu diễn danh tính hiện tại |
| `BCryptPasswordHasher`, `HmacVerificationCodeProvider` | Hiện thực port mật khẩu và mã OTP |
| `JsonAuthenticationEntryPoint`, `JsonAccessDeniedHandler` | Phản hồi lỗi xác thực/phân quyền |
| `ApiExceptionBoundaryFilter`, `JsonCorsProcessor` | Xử lý ranh giới lỗi và CORS theo cấu hình |
| `security/ratelimit/*` | Thành phần giới hạn tần suất yêu cầu xác thực |

Luồng tổng quan của request cần JWT:

```mermaid
flowchart TD
    A["Client + Bearer Token"]
    B["Spring Security / JWT Filter"]
    C{"JWT hợp lệ và đủ quyền truy cập?"}
    D["Controller"]
    E["Business Service"]
    F{"Quyền nghiệp vụ / Ownership hợp lệ?"}
    G["Xử lý nghiệp vụ"]
    H["HTTP Response"]
    I["401 Unauthorized / 403 Forbidden"]
    J["403 Forbidden hoặc lỗi nghiệp vụ phù hợp"]
    K([Kết thúc])

    A --> B --> C

    C -->|Có| D
    C -->|Không| I --> K

    D --> E --> F

    F -->|Có hoặc không cần kiểm tra| G
    F -->|Không| J

    G --> H --> K
    J --> K
```

Với đăng ký/xác minh email, hệ thống còn có `EmailVerificationService`, `VerificationCodeProvider` và `EmailVerificationSender`. `notification/SmtpEmailVerificationSender` gửi email thông qua SMTP; Mailpit có thể dùng làm SMTP thử nghiệm. **OTP và JWT là hai cơ chế khác nhau**: OTP xác minh email, còn JWT xác thực các request sau đăng nhập.

### Phân quyền

Source có `RoleManagementController`/`RoleManagementService` và `BootstrapSuperAdminService`, phản ánh việc hỗ trợ `USER`, `ADMIN` và `SUPER_ADMIN`. Các rule method/path cụ thể phải khớp với `SecurityConfig` và tài liệu [04-api-design.md](04-api-design.md). Kiểm tra quyền truy cập endpoint ở lớp Security không thay thế việc kiểm tra quyền sở hữu booking tại Business.

## 5.8. Cấu hình và xử lý lỗi

- `config/`: `AuthConfig`, `EmailVerificationConfig`, `UserConfig`, `OpenApiConfig`, `TimeConfig`, `BootstrapSuperAdminProperties`.
- `exception/`: `GlobalExceptionHandler`, `ErrorResponse`, `ApiErrorController`, `ApiErrorWriter`.
- `resources/`: `application.properties`, `application-dev.properties`, `application-test.properties` và migration Flyway **V1–V16**.

**Hai nhóm exception khác nhau:** `domain/exception` mô tả lỗi nghiệp vụ; `exception/` chuyển lỗi phù hợp thành phản hồi HTTP/JSON. Lỗi bị Spring Security từ chối trước controller được xử lý qua các handler/filter liên quan.

Không đưa giá trị JWT secret, OTP secret, mật khẩu PostgreSQL hoặc tài khoản thật vào tài liệu hay repository.

## 5.9. Ví dụ luồng xử lý: tạo Booking

Ví dụ ở mức thành phần, không thay thế đặc tả API:

1. Client gửi `POST /api/bookings` với JWT và payload đặt vé.
2. Spring Security xử lý xác thực và quyền truy cập vào endpoint.
3. `BookingController` tiếp nhận DTO, sau đó chuyển yêu cầu đến `BookingService`.
4. `BookingService` kiểm tra điều kiện chuyến xe, số lượng vé và quyền nghiệp vụ cần thiết.
5. Service gọi repository port, adapter sử dụng Spring Data JPA và persistence mapper để đọc/ghi dữ liệu.
6. Trong `@Transactional`, service khóa Trip bằng `PESSIMISTIC_WRITE`, giảm ghế bằng update có điều kiện không âm rồi lưu Booking; lỗi lưu làm rollback cả phần giảm ghế.
7. Kết quả được ánh xạ thành `BookingResponse` và trả về client.

Đối với các yêu cầu đồng thời, code kết hợp transaction, khóa bi quan và cập nhật ghế có điều kiện. Hủy Booking khóa Booking rồi Trip, kiểm tra capacity, hoàn ghế rồi cập nhật trạng thái trong cùng giao dịch. `TripBookingIntegrationTest` có test cạnh tranh ghế cuối và rollback; kết quả pass hiện tại chưa xác minh.

## 5.10. Quy tắc phụ thuộc và tổ chức kiểm thử

### Luồng gọi và hướng phụ thuộc

**Luồng gọi khi chạy:** Sơ đồ minh họa nhánh JPA; OTP/quản lý role có nhánh `JdbcTemplate` trực tiếp tại adapter.

```mermaid
flowchart TD
    A["HTTP Request"]
    B["Security Filter"]
    C["Controller"]
    D["Business Service"]
    E["Repository Port"]
    F["Data Adapter"]
    G["Spring Data JPA"]
    H[("PostgreSQL")]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
```

**Hướng phụ thuộc trong thiết kế:**

```mermaid
flowchart TD
    API["api/controller"]
    SERVICE["business/service"]
    PORT["business/port"]
    DOMAIN["domain"]

    ADAPTER["data/adapter"]
    REPO["data/repository"]
    JPA["Spring Data JPA"]

    SECURITY["security adapters"]
    NOTIFICATION["notification adapters"]

    API --> SERVICE
    SERVICE --> PORT
    SERVICE --> DOMAIN

    ADAPTER -.->|"implements"| PORT
    ADAPTER --> DOMAIN
    ADAPTER --> REPO

    REPO --> JPA

    SECURITY -.->|"implements"| PORT
    NOTIFICATION -.->|"implements"| PORT
```

Mũi tên adapter trỏ đến port biểu thị **dependency inversion**: Business định nghĩa hợp đồng; hạ tầng phụ thuộc vào hợp đồng để triển khai. Không nên diễn giải sơ đồ gọi lúc chạy thành việc Business import trực tiếp lớp `data/adapter`.

### Test hiện có trong cây `src/test`

| Nhóm | Ví dụ class |
|---|---|
| API / HTTP | `AuthHttpIntegrationTest`, `BookingControllerTest`, `AuthRateLimitHttpTest`, `ProfileAndRolesIntegrationTest` |
| Business | `BookingServiceTest`, `TripServiceTest`, `OperatorServiceTest`, `RoleManagementServiceTest` |
| Persistence | `AuthPersistenceIntegrationTest`, `TripRepositoryAdapterTest` |
| Integration | `TripBookingIntegrationTest`, `CoreCatalogWorkflowIntegrationTest`, `AdminManagementIntegrationTest` |
| Security / Notification | `JwtAuthenticationFilterTest`, `JwtServiceTest`, `AuthRequestRateLimiterTest`, `SmtpEmailVerificationSenderTest` |

Bài kiểm thử tải trên Kaggle CPU được lưu riêng trong `load-tests/`, tránh nhầm với unit/integration test Maven.

