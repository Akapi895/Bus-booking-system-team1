# Demo frontend

Small static UI (HTML + vanilla JS, no build step) for demoing the BusBooking API.
Not a product frontend: the team's scope is backend system design.

## Run

```bash
docker compose up -d --build
```

Open http://localhost:5173. Nginx serves these files and proxies `/api` to the backend, so no CORS setup is needed.
Edits to `frontend/*` show up on browser refresh (files are mounted, not copied).

Catalog data for a fresh DB:

```bash
docker exec -i busbooking-db psql -U busbooking_user -d busbooking_dev_fresh < load-tests/datasets/busbooking_seed.sql
```

## Screens

| Screen | API |
|---|---|
| Tìm chuyến, đặt vé | `GET /api/locations`, `GET /api/trips`, `POST /api/bookings` |
| Vé của tôi, huỷ vé | `GET /api/users/me/bookings`, `DELETE /api/bookings/{id}` |
| Đăng ký → OTP (Mailpit http://localhost:8026) → đăng nhập | `POST /api/auth/register`, `/verify-email`, `/login`, `GET /api/auth/me` |
| Thử tải đồng thời | fires N `POST /api/bookings` at once on one trip, then checks seats before − successes = seats after |

## Notes

- JWT is kept in `sessionStorage`; fine for a demo, not for production.
- All browser traffic reaches the backend from the Nginx container IP, so the auth rate limit (5 registers / 10 logins per minute) is shared by every user of the UI. WS4 fixes this with trusted proxy headers.
- If WS1 adds an `Idempotency-Key` header, also add it to the CORS allowed headers in `SecurityConfig` for clients on other origins (not needed for this UI, which is same-origin).
