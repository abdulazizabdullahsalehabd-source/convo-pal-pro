# بناء ملف APK لتطبيق «صديق المحادثة»

المشروع الأندرويد جاهز (Capacitor) ويفتح التطبيق المنشور: https://convo-pal-pro.lovable.app

## الطريقة الأسهل (بدون تثبيت أي شيء)
1. اربط المشروع بـ GitHub من زر GitHub في Lovable وادفع الكود.
2. افتح تبويب **Actions** في مستودعك → شغّل «Build Android APK» (يعمل تلقائياً عند كل push إلى main).
3. بعد انتهاء البناء نزّل الملف من **Artifacts** باسم `sadeeq-almuhadatha-apk` → داخله `app-debug.apk`.
4. انقل الملف إلى هاتفك وفعّل «تثبيت من مصادر غير معروفة» ثم ثبّته.

## البناء على جهازك
```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
# الناتج: android/app/build/outputs/apk/debug/app-debug.apk
```
يتطلب Java 21 و Android SDK (أو Android Studio).

## ملاحظات
- إذن الميكروفون مضاف في `AndroidManifest.xml`، ويطلبه التطبيق عند أول تسجيل.
- لتغيير الرابط الذي يفتحه التطبيق، عدّل `server.url` في `capacitor.config.ts` ثم `npx cap sync android`.
