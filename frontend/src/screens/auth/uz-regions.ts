/**
 * screens/auth/uz-regions — Uzbekistan regions (viloyat) → districts (tuman),
 * the data behind the registration "Manzil" step's cascading dropdowns.
 *
 * Coverage: all 14 top-level administrative units — Toshkent shahri (the capital
 * city, shown first to match the mockup default), the 12 viloyats, and the
 * Qoraqalpog'iston Respublikasi — each with its main tumans (and, where useful,
 * the region's key cities that administratively sit alongside the tumans).
 *
 * NOTE (owner can refine): district lists aim to be reasonably complete rather
 * than exhaustive, and a couple of names are approximate/transliterated (Uzbek
 * Latin varies in practice — e.g. "ko'chasi" apostrophes, tuman vs shahar
 * boundaries that shift as new districts are carved out). Region names use the
 * "… viloyati" suffix so "Toshkent shahri" (city) is unambiguous vs "Toshkent
 * viloyati" (surrounding region). Values are stored verbatim in `users.region`
 * / `users.district`.
 */

export interface UzRegion {
  /** Region name, stored verbatim in `users.region`. */
  name: string;
  /** Districts (tumans) + notable cities, stored verbatim in `users.district`. */
  districts: string[];
}

export const UZ_REGIONS: readonly UzRegion[] = [
  {
    name: "Toshkent shahri",
    districts: [
      "Bektemir tumani",
      "Chilonzor tumani",
      "Mirobod tumani",
      "Mirzo Ulug'bek tumani",
      "Olmazor tumani",
      "Sergeli tumani",
      "Shayxontohur tumani",
      "Uchtepa tumani",
      "Yakkasaroy tumani",
      "Yashnobod tumani",
      "Yangihayot tumani",
      "Yunusobod tumani",
    ],
  },
  {
    name: "Toshkent viloyati",
    districts: [
      "Angren shahri",
      "Bekobod tumani",
      "Bo'ka tumani",
      "Bo'stonliq tumani",
      "Chinoz tumani",
      "Chirchiq shahri",
      "Ohangaron tumani",
      "Oqqo'rg'on tumani",
      "Olmaliq shahri",
      "O'rtachirchiq tumani",
      "Parkent tumani",
      "Piskent tumani",
      "Qibray tumani",
      "Quyichirchiq tumani",
      "Yangiyo'l tumani",
      "Yuqorichirchiq tumani",
      "Zangiota tumani",
    ],
  },
  {
    name: "Andijon viloyati",
    districts: [
      "Andijon shahri",
      "Andijon tumani",
      "Asaka tumani",
      "Baliqchi tumani",
      "Buloqboshi tumani",
      "Izboskan tumani",
      "Jalaquduq tumani",
      "Xo'jaobod tumani",
      "Xonobod shahri",
      "Marhamat tumani",
      "Oltinko'l tumani",
      "Paxtaobod tumani",
      "Qo'rg'ontepa tumani",
      "Shahrixon tumani",
      "Ulug'nor tumani",
    ],
  },
  {
    name: "Buxoro viloyati",
    districts: [
      "Buxoro shahri",
      "Buxoro tumani",
      "G'ijduvon tumani",
      "Jondor tumani",
      "Kogon shahri",
      "Kogon tumani",
      "Olot tumani",
      "Peshku tumani",
      "Qorako'l tumani",
      "Qorovulbozor tumani",
      "Romitan tumani",
      "Shofirkon tumani",
      "Vobkent tumani",
    ],
  },
  {
    name: "Farg'ona viloyati",
    districts: [
      "Farg'ona shahri",
      "Farg'ona tumani",
      "Marg'ilon shahri",
      "Qo'qon shahri",
      "Quvasoy shahri",
      "Beshariq tumani",
      "Bog'dod tumani",
      "Buvayda tumani",
      "Dang'ara tumani",
      "Furqat tumani",
      "Oltiariq tumani",
      "Qo'shtepa tumani",
      "Quva tumani",
      "Rishton tumani",
      "So'x tumani",
      "Toshloq tumani",
      "Uchko'prik tumani",
      "O'zbekiston tumani",
      "Yozyovon tumani",
    ],
  },
  {
    name: "Jizzax viloyati",
    districts: [
      "Jizzax shahri",
      "Jizzax tumani",
      "Arnasoy tumani",
      "Baxmal tumani",
      "Do'stlik tumani",
      "Forish tumani",
      "G'allaorol tumani",
      "Mirzacho'l tumani",
      "Paxtakor tumani",
      "Sharof Rashidov tumani",
      "Yangiobod tumani",
      "Zafarobod tumani",
      "Zarbdor tumani",
      "Zomin tumani",
    ],
  },
  {
    name: "Xorazm viloyati",
    districts: [
      "Urganch shahri",
      "Urganch tumani",
      "Xiva shahri",
      "Bog'ot tumani",
      "Gurlan tumani",
      "Hazorasp tumani",
      "Xonqa tumani",
      "Qo'shko'pir tumani",
      "Shovot tumani",
      "Tuproqqal'a tumani",
      "Yangiariq tumani",
      "Yangibozor tumani",
    ],
  },
  {
    name: "Namangan viloyati",
    districts: [
      "Namangan shahri",
      "Namangan tumani",
      "Chortoq tumani",
      "Chust tumani",
      "Davlatobod tumani",
      "Kosonsoy tumani",
      "Mingbuloq tumani",
      "Norin tumani",
      "Pop tumani",
      "To'raqo'rg'on tumani",
      "Uchqo'rg'on tumani",
      "Uychi tumani",
      "Yangiqo'rg'on tumani",
    ],
  },
  {
    name: "Navoiy viloyati",
    districts: [
      "Navoiy shahri",
      "Zarafshon shahri",
      "Karmana tumani",
      "Konimex tumani",
      "Navbahor tumani",
      "Nurota tumani",
      "Qiziltepa tumani",
      "Tomdi tumani",
      "Uchquduq tumani",
      "Xatirchi tumani",
    ],
  },
  {
    name: "Qashqadaryo viloyati",
    districts: [
      "Qarshi shahri",
      "Qarshi tumani",
      "Shahrisabz shahri",
      "Shahrisabz tumani",
      "Chiroqchi tumani",
      "Dehqonobod tumani",
      "G'uzor tumani",
      "Kasbi tumani",
      "Kitob tumani",
      "Koson tumani",
      "Ko'kdala tumani",
      "Mirishkor tumani",
      "Muborak tumani",
      "Nishon tumani",
      "Qamashi tumani",
      "Yakkabog' tumani",
    ],
  },
  {
    name: "Samarqand viloyati",
    districts: [
      "Samarqand shahri",
      "Samarqand tumani",
      "Kattaqo'rg'on shahri",
      "Kattaqo'rg'on tumani",
      "Bulung'ur tumani",
      "Ishtixon tumani",
      "Jomboy tumani",
      "Narpay tumani",
      "Nurobod tumani",
      "Oqdaryo tumani",
      "Payariq tumani",
      "Pastdarg'om tumani",
      "Paxtachi tumani",
      "Qo'shrabot tumani",
      "Tayloq tumani",
      "Urgut tumani",
    ],
  },
  {
    name: "Sirdaryo viloyati",
    districts: [
      "Guliston shahri",
      "Guliston tumani",
      "Shirin shahri",
      "Yangiyer shahri",
      "Boyovut tumani",
      "Xovos tumani",
      "Mirzaobod tumani",
      "Oqoltin tumani",
      "Sardoba tumani",
      "Sayxunobod tumani",
      "Sirdaryo tumani",
    ],
  },
  {
    name: "Surxondaryo viloyati",
    districts: [
      "Termiz shahri",
      "Termiz tumani",
      "Angor tumani",
      "Bandixon tumani",
      "Boysun tumani",
      "Denov tumani",
      "Jarqo'rg'on tumani",
      "Muzrabot tumani",
      "Oltinsoy tumani",
      "Qiziriq tumani",
      "Qumqo'rg'on tumani",
      "Sariosiyo tumani",
      "Sherobod tumani",
      "Sho'rchi tumani",
      "Uzun tumani",
    ],
  },
  {
    name: "Qoraqalpog'iston Respublikasi",
    districts: [
      "Nukus shahri",
      "Nukus tumani",
      "Amudaryo tumani",
      "Beruniy tumani",
      "Bo'zatov tumani",
      "Chimboy tumani",
      "Ellikqal'a tumani",
      "Kegeyli tumani",
      "Mo'ynoq tumani",
      "Qanliko'l tumani",
      "Qo'ng'irot tumani",
      "Qorao'zak tumani",
      "Shumanay tumani",
      "Taxtako'pir tumani",
      "To'rtko'l tumani",
      "Xo'jayli tumani",
    ],
  },
];

/** The region names, in display order (drives the Viloyat dropdown). */
export const UZ_REGION_NAMES: readonly string[] = UZ_REGIONS.map((r) => r.name);

/** Districts for a region name, or `[]` if the region is unknown/empty. */
export function districtsFor(region: string): readonly string[] {
  return UZ_REGIONS.find((r) => r.name === region)?.districts ?? [];
}
