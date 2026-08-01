/**
 * Built-in Arabic messages — framework OKE codes + typed failure messages.
 */

export const builtinAr = {
  oke: {
    "1001": {
      cause: 'التدفق "{flow}" يقرأ "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.reads لهذا التدفق.',
    },
    "1002": {
      cause: 'التدفق "{flow}" يكتب "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.writes لهذا التدفق.',
    },
    "1003": {
      cause: 'التدفق "{flow}" يُصدِر "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.emits لهذا التدفق.',
    },
    "1004": {
      cause: 'التدفق "{flow}" يرسل "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.sends لهذا التدفق.',
    },
    "1005": {
      cause: 'التدفق "{flow}" يستدعي النموذج "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.asks لهذا التدفق.',
    },
    "1006": {
      cause: 'التدفق "{flow}" يقرأ السر "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.secrets لهذا التدفق.',
    },
    "1007": {
      cause: 'التدفق "{flow}" يستدعي التدفق "{resource}" دون الإعلان عنه.',
      fix: 'أضف "{resource}" إلى effects.calls لهذا التدفق.',
    },
    "1042": {
      cause: 'التدفق "{flow}" يُصدِر الإشارة "{resource}" بلا مشترك.',
      fix: "أضف on({resource}, …) أو عيّن الإشارة '{'optional: true'}'.",
    },
    "1101": {
      cause: "جدول النطاق غير موجود — لم تُطبَّق الترحيلات.",
      fix: "شغّل `oke db migrate` على هذه البيئة.",
    },
  },
  errors: {
    Unauthorized: "المصادقة مطلوبة.",
    Forbidden: "غير مسموح لك بتنفيذ هذا الإجراء.",
    RateLimited: "طلبات كثيرة جداً. حاول لاحقاً.",
    ValidationError: "فشل التحقق من الطلب.",
    NotFound: "المورد المطلوب غير موجود.",
    AuthFailed: "فشلت المصادقة.",
    AuthRateLimited: "محاولات مصادقة كثيرة جداً. حاول لاحقاً.",
    "AuthFailed.invalid_credentials": "بيانات الاعتماد غير صحيحة.",
    "AuthFailed.invalid_refresh": "رمز التحديث غير صالح أو منتهٍ.",
    "AuthFailed.invalid_email": "أدخل بريداً إلكترونياً صالحاً.",
    "AuthFailed.invalid_phone": "أدخل رقم هاتف صالحاً.",
    "AuthFailed.unauthenticated": "سجّل الدخول للمتابعة.",
    "AuthFailed.password_breached": "اختر كلمة مرور أخرى — هذه تظهر في قائمة اختراق.",
    "AuthFailed.username_policy": "اسم المستخدم لا يستوفي متطلبات السياسة.",
    "AuthFailed.password_policy": "كلمة المرور لا تستوفي متطلبات السياسة.",
    "AuthFailed.invalid_origin": "تم رفض أصل مفتاح المرور.",
    "Forbidden.csrf": "تم حظر الطلب عبر المواقع.",
    "Forbidden.ip_denied": "عنوان IP الخاص بك محظور.",
    "Forbidden.ip_not_allowed": "عنوان IP الخاص بك غير مسموح.",
    "Forbidden.policy_denied": "رفضت السياسة هذا الطلب.",
    "AuthRateLimited.rate_limited": "محاولات مصادقة كثيرة جداً. حاول لاحقاً.",
  },
} as const;
