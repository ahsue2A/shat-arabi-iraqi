مشروع شات عربي عراقي - نسخة Firebase أولية

الملفات: index.html واجهة الموقع، style.css التصميم، app.js ربط Firebase، firestore.rules قواعد الأمان.

قبل التجربة:
1) Firebase Console > Authentication > Sign-in method: تأكد من تفعيل Email/Password وفعّل Anonymous حتى يعمل الدخول كزائر.
2) Firestore Database > Rules: انسخ محتوى firestore.rules مكان القواعد الحالية واضغط Publish. لا تستخدم Test mode ولا تجعل القاعدة مفتوحة للجميع.
3) ارفع الملفات إلى استضافة HTTPS مثل Firebase Hosting. لا تفتح index.html مباشرة من مدير الملفات.
4) إذا ظهر خطأ domain، أضف عنوان الموقع إلى Authentication > Settings > Authorized domains.

هذه نسخة أولية بغرفة عامة واحدة فقط. لا تتضمن حالياً غرفاً خاصة أو أدوات مشرفين أو بلاغات.