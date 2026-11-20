# MailStudio

Một ứng dụng thư trên máy tính cho **nhiều tài khoản, nhiều nhà cung cấp**: Gmail, Outlook /
Microsoft 365, Yahoo, iCloud, Zoho, Yandex, Fastmail, AOL, GMX, Mail.ru và mọi máy chủ IMAP/SMTP
khác. Viết bằng Rust + Tauri 2, chạy trên Windows, macOS và Linux.

## Tính năng

- **Tài khoản**: thêm nhiều tài khoản; tự nhận diện nhà cung cấp theo địa chỉ e-mail và điền sẵn
  máy chủ; kiểm tra kết nối IMAP + SMTP trước khi lưu; màu và chữ ký riêng cho từng tài khoản.
- **Đăng nhập**: mật khẩu / mật khẩu ứng dụng, hoặc OAuth 2 (PKCE, trình duyệt hệ thống) cho Google
  và Microsoft. Mật khẩu và refresh token nằm trong kho khoá của hệ điều hành, không nằm trong
  cơ sở dữ liệu.
- **Hộp thư**: hộp thư đến hợp nhất, Chưa đọc, Gắn sao; cây thư mục từng tài khoản (nhận diện Đã gửi,
  Thư nháp, Thùng rác, Thư rác, Lưu trữ qua SPECIAL-USE hoặc tên); tạo / đổi tên / xoá thư mục.
- **Đồng bộ**: tăng dần theo UID, đối chiếu cờ và thư đã xoá, tự chạy theo chu kỳ, tải trước nội
  dung thư nhỏ để đọc ngoại tuyến; thông báo khi có thư mới.
- **Đọc thư**: HTML được làm sạch ở backend và hiển thị trong shadow DOM; ảnh từ internet bị chặn
  cho tới khi bạn cho phép; mở / lưu tệp đính kèm; xem mã nguồn thư.
- **Thao tác**: đã đọc / chưa đọc, gắn sao, lưu trữ, chuyển thư mục (kể cả kéo-thả), thư rác, xoá;
  chọn nhiều thư; phím tắt.
- **Soạn thư**: thư mới, trả lời, trả lời tất cả, chuyển tiếp (kèm tệp gốc); To / Cc / Bcc có gợi ý
  từ danh bạ tự thu thập; định dạng cơ bản; đính kèm tệp; thư nháp tự lưu trên máy.
- **Tìm kiếm** trong thư đã đồng bộ (người gửi, người nhận, tiêu đề, trích đoạn) và bộ lọc nhanh.
- Giao diện tiếng Việt / tiếng Anh, sáng / tối / theo hệ thống.

## Tiện ích giao diện

- **Cột tài khoản** ở mép trái: mỗi tài khoản là một ô vuông bo nhẹ mang chữ viết tắt và màu của tài khoản, kèm huy hiệu số thư chưa đọc trong Hộp thư đến (tối đa `99+`). Bấm vào để mở Hộp thư đến của tài khoản đó; ô trên cùng là "Tất cả hộp thư đến".
- **Bố cục**: khung đọc nằm bên phải hoặc bên dưới; kéo vách ngăn để đổi kích thước, nhấp đúp để về mặc định.
- **Thanh trạng thái** luôn có Bố cục, Nhật ký hoạt động, Phím tắt, thu phóng, phiên bản, Trợ giúp và Cài đặt.
- **Ctrl+/** mở cửa sổ phím tắt (có ô lọc); **F1** mở trợ giúp; **Ctrl+Shift+L** mở nhật ký hoạt động (tìm kiếm, lọc, sao chép, xoá; lưu 500 thao tác gần nhất trên máy, không ghi nội dung thư, địa chỉ hay mật khẩu).
- **Ctrl + / Ctrl - / Ctrl 0** phóng to, thu nhỏ, đặt lại cỡ giao diện (60–200%).
- Các phím **F1–F12** và **Ctrl+R** không còn kích hoạt hành vi mặc định của webview (F5 tải lại ứng dụng, F3 tìm kiếm, F12 công cụ nhà phát triển…).
- Xem trước tệp đính kèm ngay trong ứng dụng: ảnh, văn bản, âm thanh, video và PDF (tối đa 20 MB).
- Nhấn **phiên bản** để xem thông tin ứng dụng và thư mục dữ liệu. Chưa có kiểm tra/cài đặt cập nhật tự động.

## Phát hành

```bash
pnpm release patch            # hoặc minor | major | x.y.z, thêm --dry-run để xem trước
pnpm check:version            # kiểm tra 3 file phiên bản khớp nhau
```

Script tăng phiên bản đồng bộ ở `package.json`, `Cargo.toml` và `src-tauri/tauri.conf.json`, ghi `CHANGELOG.md` từ lịch sử commit, tạo commit `chore(release): vX.Y.Z` và tag — không tự push.

## Chạy thử

Cần Rust (≥ 1.90), Node.js và pnpm.

```sh
pnpm install
pnpm tauri dev          # ứng dụng desktop
```

Phát triển giao diện trong trình duyệt, vẫn dùng backend thật qua cầu nối HTTP chỉ dành cho dev:

```sh
pnpm bridge             # backend trên 127.0.0.1:1441
pnpm dev                # giao diện trên http://localhost:1440
```

### Máy chủ thư giả để phát triển

Không cần hộp thư thật:

```sh
pnpm mailserver         # IMAP 127.0.0.1:1143, SMTP 127.0.0.1:1025 (cần Python 3)
```

Trong MailStudio thêm tài khoản `demo@mailstudio.test` (và `second@mailstudio.test`), nhà cung cấp
**Khác**, máy chủ `127.0.0.1`, bảo mật **Không**, cổng IMAP `1143`, SMTP `1025`, mật khẩu bất kỳ.
Mọi thứ nằm trong bộ nhớ và mất khi tắt máy chủ.

Biến môi trường cho dev: `MAILSTUDIO_DATA_DIR` đổi nơi lưu dữ liệu; `MAILSTUDIO_SECRETS=file` lưu
mật khẩu vào cơ sở dữ liệu thay cho kho khoá (chỉ dùng với máy chủ giả / máy không có kho khoá).

## Kiểm tra

```sh
cargo test --workspace
cargo clippy --workspace --all-targets --features mailstudio/dev-bridge
pnpm test && pnpm lint && pnpm build
```

## Đăng nhập với từng nhà cung cấp

| Nhà cung cấp                               | Cách đăng nhập                                                    |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Gmail                                      | Mật khẩu ứng dụng (cần bật xác minh 2 bước), hoặc OAuth           |
| Outlook.com / Microsoft 365                | OAuth (Microsoft đã tắt đăng nhập mật khẩu với hầu hết tài khoản) |
| Yahoo, iCloud, Zoho, Yandex, Fastmail, AOL | Mật khẩu ứng dụng                                                 |
| GMX, Mail.ru, máy chủ riêng                | Mật khẩu thường (tuỳ máy chủ)                                     |

Với tên miền riêng (thư công ty), MailStudio tự dò máy chủ: hỏi dịch vụ autoconfig của chính tên
miền (`autoconfig.<tên miền>`), rồi cơ sở dữ liệu nhà cung cấp công khai của Mozilla
(`autoconfig.thunderbird.net`), cuối cùng thử các tên quen thuộc `imap.` / `smtp.` / `mail.`. Chỉ tên
miền được gửi đi, không gửi địa chỉ e-mail.

OAuth cần **client ID của riêng bạn** (Cài đặt → Đăng nhập (OAuth)): Google và Microsoft chỉ cho phép
ứng dụng đã đăng ký với họ, và dự án này không kèm sẵn client ID nào.

## Kiến trúc

```
crates/mailstudio-core   backend không phụ thuộc UI: một hàm dispatch(cmd, args)
  db.rs        SQLite: tài khoản, thư mục, tiêu đề thư, thư thô, nháp, danh bạ, cài đặt
  imap.rs      kết nối TLS/STARTTLS, đăng nhập, pool phiên, lệnh IMAP, UTF-7
  sync.rs      đồng bộ, thay đổi cờ / di chuyển / xoá, thư mục, vòng lặp nền
  mime.rs      đọc tiêu đề, nội dung, tệp đính kèm; làm sạch HTML
  compose.rs   thư nháp, dựng MIME, gửi SMTP
  oauth.rs     OAuth 2 PKCE với redirect loopback
  providers.rs cấu hình sẵn của các nhà cung cấp
  secrets.rs   kho khoá hệ điều hành
  events.rs    sự kiện backend → UI (long-poll)
src-tauri                vỏ Tauri mỏng + cầu nối HTTP cho dev
src                      giao diện React + TypeScript + Tailwind + zustand
scripts/dev-mail-server.py   máy chủ IMAP/SMTP giả
assets/icons                 ảnh gốc của icon ứng dụng và icon thanh trạng thái
scripts/make-icons.py        sinh lại toàn bộ icon từ hai ảnh gốc (cần Pillow + numpy)
```

## Giới hạn hiện tại

- Chỉ IMAP/SMTP: chưa có POP3, Exchange (EWS/Graph) hay JMAP.
- Thư nháp chỉ lưu trên máy, chưa đồng bộ lên thư mục Drafts của máy chủ.
- Tìm kiếm chỉ trên thư đã đồng bộ về máy; chưa tìm trên máy chủ.
- Chưa gom thư theo cuộc hội thoại; chưa có IMAP IDLE (thư mới đến theo chu kỳ đồng bộ).
- Chưa có bộ cài đặt ký số / tự cập nhật; bản di động chưa được thử.
