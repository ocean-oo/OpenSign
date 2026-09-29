# Giá trị pháp lý của tài liệu ký trên TNI DocSign

Về kỹ thuật, TNI DocSign hiện tại đã ký số thật vào PDF, nhưng chưa đủ
điều kiện để được coi là chữ ký số có giá trị pháp lý đầy đủ theo pháp
luật Việt Nam. Chi tiết:

## 1. Hệ thống đang làm được gì (đã kiểm chứng trong code)

- Chữ ký người dùng (vẽ/gõ/tải lên) được chèn vào PDF dưới dạng ảnh,
  rồi flatten vào file.
- Khi đủ chữ ký (isCompleted), server ký số PAdES vào PDF cuối bằng
  1 file PFX chung: `PDF.js:502-508` (P12Signer + SignPdf.sign),
  nguồn từ `PFX_BASE64` env hoặc `TenantId.PfxFile`.
- Tạo thêm 1 file "Chứng nhận hoàn thành" và ký số riêng:
  `generateCertificatebydocId.js:68-83`.
- Lưu bằng chứng: AuditTrail (email, IP, SignedOn/ViewedOn),
  DocumentHash, OTP email bắt buộc, SSO Keycloak, màn hình đồng ý
  điều khoản (term-cond).

Cái này tương đương chữ ký điện tử thông thường + nhật ký chứng cứ —
đủ để chứng minh "ai, khi nào, ký cái gì" trong nội bộ.

## 2. Vì sao chưa có giá trị pháp lý đầy đủ

Theo Luật Giao dịch điện tử 2023, chữ ký số chỉ có giá trị tương đương
chữ ký tay + con dấu khi chứng thư số do tổ chức CA được Bộ TT&TT cấp
phép (Viettel-CA, VNPT-CA, FPT-CA...) cấp cho chính người ký. Hệ thống
hiện tại vướng 3 điểm:

1. PFX chung, tự tạo/nội bộ — không phải cert cá nhân của từng người ký,
   Adobe Reader sẽ báo "chữ ký không được tin cậy". Đây là điểm chí mạng nhất.
2. Định danh yếu — OTP qua email + SSO chỉ chứng minh được "chủ tài khoản",
   không ràng buộc danh tính pháp lý thật (chưa eKYC CCCD, chưa chứng thư
   số cá nhân). Face capture mới ở kế hoạch, chưa implement.
3. Thiếu timestamp tin cậy (TSA) và LTV/OCSP — sau vài năm cert hết hạn
   sẽ khó xác minh chữ ký còn hiệu lực tại thời điểm ký hay không.

## 3. Lộ trình đề xuất (theo mức độ cần)

- Mức 1 — dùng ngay cho nội bộ, biên bản bàn giao, thỏa thuận dân sự:
  hiện trạng + bắt buộc OTP (đã có) + giữ AuditTrail/DocumentHash/chứng nhận
  hoàn thành + thêm điều khoản vào mẫu tài liệu: "các bên đồng ý giao dịch
  bằng phương thức điện tử qua TNI DocSign". Với sự thỏa thuận trước này,
  tài liệu có giá trị chứng cứ tốt khi tranh chấp dân sự.
- Mức 2 — hợp đồng kinh tế, giao dịch với đối tác: tích hợp ký số từ xa
  (remote signing) qua 1 CA Việt Nam — mỗi người ký dùng chứng thư số cá
  nhân của mình (ký qua app/OTP của CA), hệ thống chuyển từ "ký thay bằng
  PFX chung" sang "mỗi signer 1 chữ ký PAdES riêng + TSA timestamp".
  Đây mới là việc làm cho tài liệu tương đương văn bản giấy.
- Mức 3 — hồ sơ nhân sự, văn bản gửi cơ quan nhà nước: thêm eKYC
  (CCCD gắn chip / VNeID) trước lần ký đầu + lưu trữ log tối thiểu theo
  quy định + chính sách lưu trữ, phân quyền, sao lưu rõ ràng.

Lưu ý: nội dung này mang tính kỹ thuật — trước khi dùng cho hợp đồng giá
trị lớn, nên nhờ pháp chế rà soát điều khoản đồng thuận ký điện tử và xác
nhận CA các bạn định tích hợp.

## 4. Thêm điều khoản vào mẫu tài liệu — cần làm việc gì với pháp chế

Mục tiêu của điều khoản này rất thực tế: để khi có tranh chấp, doanh nghiệp
chứng minh được các bên đã tự nguyện thỏa thuận dùng phương thức điện tử
trước khi ký, chứ không phải bị ép ký trên một hệ thống lạ.

Nội dung đề nghị pháp chế soạn hoặc duyệt, đưa vào phần mở đầu hoặc phụ lục
của mọi mẫu tài liệu, gồm 5 ý:

1. Các bên đồng ý giao dịch, xem xét và ký tài liệu bằng phương thức điện tử
   thông qua hệ thống TNI DocSign.
2. Mỗi bên xác nhận tài khoản SSO, email nhận OTP và chữ ký tạo trên hệ thống
   là của chính mình; mọi hành vi ký bằng tài khoản đó được coi là ý chí
   của bên ký.
3. Các bên thừa nhận AuditTrail (email, IP, thời gian ký), mã hash tài liệu
   và Chứng nhận hoàn thành do hệ thống phát hành là chứng cứ hợp lệ để xác
   định tính toàn vẹn của tài liệu.
4. Trường hợp pháp luật chuyên ngành yêu cầu hình thức văn bản giấy hoặc
   công chứng/chứng thực, tài liệu điện tử này không thay thế; các bên sẽ ký
   bổ sung bản giấy khi cần.
5. Cách thức giải quyết khi một bên phủ nhận chữ ký: đối chiếu OTP/email/SSO
   log, hash tài liệu và chứng nhận hoàn thành.

Và pháp chế cần quyết 4 việc:

1. Chốt văn bản điều khoản chuẩn (làm bản song ngữ nếu có đối tác nước ngoài).
2. Xác định loại tài liệu nào bắt buộc phải có bản giấy kèm theo (bất động sản,
   một số loại hợp đồng lao động đặc thù, văn bản cần công chứng...).
3. Chốt thời hạn lưu trữ chứng cứ theo từng loại tài liệu.
4. Duyệt lại màn hình consent trước khi ký — xem nội dung hiện tại đã đủ
   chặt chẽ chưa, có cần bổ sung gì không.

## 5. Luồng ký số từ xa diễn ra thế nào (có phải gửi PDF cho CA không?)

Không gửi nguyên file. Luồng chuẩn của ký số từ xa như sau:

1. Bạn tạo request trên TNI DocSign như bình thường, PDF nằm trên server
   của bạn.
2. Khi tới lượt người ký, server tự tính mã hash (bản tóm tắt số, vài chục
   ký tự) của PDF rồi gửi mỗi cái hash đó sang CA.
3. Người ký mở app của CA, thấy hiện "Bạn có đồng ý ký tài liệu X từ công ty
   Y không", rồi xác nhận bằng OTP/vân tay.
4. CA dùng private key trong HSM của họ ký lên cái hash, trả về khối chữ ký
   cho server của bạn nhúng vào PDF.

Tức là CA không bao giờ thấy nội dung hợp đồng, họ chỉ chứng thực "người này
đã đồng ý ký lên tài liệu có mã hash này, vào giờ này". Nội dung PDF vẫn nằm
ở server bạn.

Đi kèm là một thực tế phải chấp nhận: với luồng qualified, mỗi người ký cần
2 thứ — một chứng thư số cá nhân do đúng CA đó cấp (đăng ký 1 lần, thường
eKYC bằng CCCD), và app của CA trên điện thoại để nhận yêu cầu và bấm duyệt
mỗi lần ký. Ký với đối tác mới là phải hướng dẫn họ đăng ký cert trước, mất
vài ngày lần đầu; những lần sau thì chỉ bấm duyệt vài giây. Đây chính là gánh
nặng onboard lớn nhất của Mức 2, cần phối hợp nghiệp vụ chứ không thuần kỹ thuật.

## 6. Đối tác nước ngoài thì sao?

Họ không thể (và không chịu) đăng ký cert của Viettel/VNPT. Có 3 cách xử lý
thực tế:

- Cách A — mỗi bên ký theo chuẩn của nước mình (khuyến nghị). Thiết kế hệ
  thống hỗ trợ nhiều provider: người Việt ký qualified qua CA Việt Nam, người
  EU ký theo chuẩn eIDAS của họ, người Mỹ thì luật ESIGN rất thoáng — OTP
  email + audit trail như hiện tại thường đã đủ. Một tài liệu có thể trộn
  nhiều loại chữ ký: chữ ký qualified của bên Việt + chữ ký điện tử thông
  thường của bên nước ngoài.
- Cách B — dùng cert toàn cầu. Một số CA quốc tế (DigiCert, GlobalSign...)
  nằm trong danh sách tin cậy sẵn của Adobe (AATL) nên Adobe xanh trên mọi máy
  thế giới. Nhưng cert này không thay thế được yêu cầu "CA được Bộ TT&TT cấp
  phép" nếu tranh chấp đưa ra tòa Việt Nam.
- Cách C — chốt luật áp dụng trong hợp đồng. Điều khoản ghi rõ tranh chấp xử
  theo luật nước nào, chấp nhận hình thức ký nào. Nhiều hợp đồng quốc tế vẫn ký
  kiểu "ký ảnh + email xác nhận" mà có hiệu lực, vì luật Mỹ/EU thoáng hơn Việt
  Nam nhiều.

Vì vậy thiết kế đúng cho Mức 2 không phải "mọi signer đều qualified" mà là
per-signer: mỗi người nhận khi được thêm vào tài liệu sẽ gán một phương thức
ký (qualified qua CA X / ký thường). Tài liệu hoàn thành khi đủ mọi chữ ký,
mỗi chữ ký mang giá trị pháp lý tương ứng với phương thức của người đó.

## 7. DocuSign họ làm thế nào, họ có cần CA không?

Câu trả lời ngắn: DocuSign bản phổ thông cũng không cần CA — họ làm y hệt
TNI DocSign bây giờ.

Chữ ký DocuSign thông thường (khoảng 90% giao dịch trên đó) chỉ gồm: gửi
email, người ký bấm link, gõ/vẽ chữ ký, xong. Không cert cá nhân, không app CA.
Bằng chứng pháp lý của họ chỉ là email + IP + timestamp + audit trail — tức là
chữ ký điện tử thông thường, tương đương Mức 1 của mình. Họ làm thế mà vẫn hợp
pháp vì luật Mỹ (ESIGN/UETA) và EU (eIDAS mức simple) chấp nhận hình thức này,
miễn các bên đồng ý giao dịch điện tử.

Chỗ khác biệt duy nhất nằm ở con dấu chống giả mạo: khi tài liệu hoàn thành,
DocuSign ký thêm 1 chữ ký số của chính DocuSign lên PDF (tamper-evident seal).
Nghe quen không? Đúng là cái PFX chung của mình (PDF.js:502-508). Khác biệt là
cert của DocuSign nằm trong danh sách tin cậy sẵn của Adobe (AATL) vì họ là
thành viên trả phí của chương trình đó. Nên mở PDF của DocuSign thì Adobe hiện
tick xanh, còn mở PDF của mình thì báo "không tin cậy" — dù kỹ thuật ký y hệt
nhau. Bài học rút ra: có thể đăng ký AATL membership cho cert hệ thống (khoảng
vài nghìn USD/năm), đổi lại con dấu hệ thống được Adobe tin cậy toàn cầu. Nó
không biến thành chữ ký số cá nhân, nhưng ít nhất đối tác nước ngoài mở file
thấy tick xanh thay vì cảnh báo đỏ.

Còn khi khách cần chữ ký qualified (QES của EU), DocuSign cũng không tự cấp —
họ tích hợp với các nhà cung cấp dịch vụ tin cậy (QTSP) của EU, người ký vẫn
phải có cert cá nhân và xác minh danh tính với QTSP đó. Tức là mô hình y hệt
plan Mức 2: nền tảng làm broker, CA làm người ký thật.

Riêng ở Việt Nam, DocuSign không phải CA được Bộ TT&TT cấp phép, nên về lý
thuyết chữ ký DocuSign ở tòa Việt Nam cũng chỉ là chữ ký điện tử thông thường,
vướng đúng 3 điểm như mục 2. Các công ty FDI vẫn dùng vì hợp đồng của họ chọn
luật nước ngoài, hoặc đơn giản là chấp nhận rủi ro đó.

Kết luận theo phân khúc:

| Phân khúc | Cách làm | Cần CA? |
|---|---|---|
| Nội bộ, biên bản | Giữ như hiện tại + điều khoản đồng thuận | Không |
| Đối tác nước ngoài | Giữ như hiện tại + AATL cho con dấu hệ thống (tick xanh Adobe) | Không, chỉ cần membership AATL |
| Hợp đồng trong nước giá trị lớn | Tích hợp CA Việt Nam, mỗi signer 1 cert cá nhân | Có, bắt buộc |

Nói cách khác: CA chỉ bắt buộc khi muốn chơi trên sân "chữ ký số" của pháp
luật Việt Nam. Còn sân quốc tế thì DocuSign đã chứng minh không cần CA vẫn
sống khỏe — cái cần là audit trail chắc + con dấu hệ thống được Adobe tin cậy
+ điều khoản đồng thuận trong hợp đồng.
