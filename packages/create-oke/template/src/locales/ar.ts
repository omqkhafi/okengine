import { defineLocale, type MessagesFor } from "okengine";
import { en } from "./en";

/**
 * Arabic message catalog — same keys as English (`satisfies MessagesFor`).
 */
const ar = {
  errors: {
    notFound: "غير موجود",
    unauthorized: "غير مصرّح",
  },
  greeting: "مرحباً، {name}",
  items:
    "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصراً} other {# عنصر}}",
  place:
    "أنهيت في المرتبة {place, selectordinal, one {#} two {#} few {#} other {#}}!",
  status: "{status, select, online {متصل} offline {غير متصل} other {غير معروف}}",
} satisfies MessagesFor<typeof en>;

defineLocale("ar", ar);
