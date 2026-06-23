// Uzbekistan address data for the registration cascading dropdowns:
// region (viloyat) → district (tuman/shahar). Names are stored verbatim on the
// user record, so keep them stable.

export const UZ_REGIONS: { name: string; districts: string[] }[] = [
  {
    name: "Toshkent shahri",
    districts: [
      "Bektemir", "Chilonzor", "Mirobod", "Mirzo Ulug'bek", "Olmazor",
      "Sergeli", "Shayxontohur", "Uchtepa", "Yakkasaroy", "Yashnobod",
      "Yunusobod",
    ],
  },
  {
    name: "Toshkent viloyati",
    districts: [
      "Bekobod", "Bo'ka", "Bo'stonliq", "Chinoz", "Qibray", "Ohangaron",
      "Oqqo'rg'on", "Parkent", "Piskent", "Quyichirchiq", "O'rtachirchiq",
      "Yuqorichirchiq", "Yangiyo'l", "Zangiota", "Angren", "Olmaliq",
      "Chirchiq", "Nurafshon",
    ],
  },
  {
    name: "Andijon viloyati",
    districts: [
      "Andijon", "Asaka", "Baliqchi", "Bo'z", "Buloqboshi", "Izboskan",
      "Jalaquduq", "Xo'jaobod", "Qo'rg'ontepa", "Marhamat", "Oltinko'l",
      "Paxtaobod", "Shahrixon", "Ulug'nor", "Andijon shahri", "Xonobod",
    ],
  },
  {
    name: "Buxoro viloyati",
    districts: [
      "Buxoro", "Olot", "G'ijduvon", "Jondor", "Kogon", "Qorako'l",
      "Qorovulbozor", "Peshku", "Romitan", "Shofirkon", "Vobkent",
      "Buxoro shahri", "Kogon shahri",
    ],
  },
  {
    name: "Farg'ona viloyati",
    districts: [
      "Bag'dod", "Beshariq", "Buvayda", "Dang'ara", "Farg'ona", "Furqat",
      "Qo'shtepa", "Quva", "Rishton", "So'x", "Toshloq", "Uchko'prik",
      "O'zbekiston", "Yozyovon", "Farg'ona shahri", "Marg'ilon", "Qo'qon",
      "Quvasoy",
    ],
  },
  {
    name: "Jizzax viloyati",
    districts: [
      "Arnasoy", "Baxmal", "Do'stlik", "Forish", "G'allaorol", "Sharof Rashidov",
      "Mirzacho'l", "Paxtakor", "Yangiobod", "Zafarobod", "Zarbdor", "Zomin",
      "Jizzax shahri",
    ],
  },
  {
    name: "Xorazm viloyati",
    districts: [
      "Bog'ot", "Gurlan", "Xonqa", "Hazorasp", "Xiva", "Qo'shko'pir",
      "Shovot", "Urganch", "Yangiariq", "Yangibozor", "Tuproqqal'a",
      "Urganch shahri", "Xiva shahri",
    ],
  },
  {
    name: "Namangan viloyati",
    districts: [
      "Chortoq", "Chust", "Kosonsoy", "Mingbuloq", "Namangan", "Norin",
      "Pop", "To'raqo'rg'on", "Uchqo'rg'on", "Uychi", "Yangiqo'rg'on",
      "Namangan shahri",
    ],
  },
  {
    name: "Navoiy viloyati",
    districts: [
      "Konimex", "Karmana", "Qiziltepa", "Xatirchi", "Navbahor", "Nurota",
      "Tomdi", "Uchquduq", "Navoiy shahri", "Zarafshon",
    ],
  },
  {
    name: "Qashqadaryo viloyati",
    districts: [
      "G'uzor", "Qamashi", "Qarshi", "Koson", "Kasbi", "Kitob", "Mirishkor",
      "Muborak", "Nishon", "Chiroqchi", "Shahrisabz", "Yakkabog'", "Dehqonobod",
      "Qarshi shahri", "Shahrisabz shahri",
    ],
  },
  {
    name: "Samarqand viloyati",
    districts: [
      "Bulung'ur", "Ishtixon", "Jomboy", "Kattaqo'rg'on", "Qo'shrabot",
      "Narpay", "Nurobod", "Oqdaryo", "Paxtachi", "Pastdarg'om", "Payariq",
      "Samarqand", "Toyloq", "Urgut", "Samarqand shahri", "Kattaqo'rg'on shahri",
    ],
  },
  {
    name: "Sirdaryo viloyati",
    districts: [
      "Boyovut", "Guliston", "Mirzaobod", "Oqoltin", "Sardoba", "Sayxunobod",
      "Sirdaryo", "Xovos", "Guliston shahri", "Shirin", "Yangiyer",
    ],
  },
  {
    name: "Surxondaryo viloyati",
    districts: [
      "Angor", "Bandixon", "Boysun", "Denov", "Jarqo'rg'on", "Qiziriq",
      "Qumqo'rg'on", "Muzrabot", "Oltinsoy", "Sariosiyo", "Sherobod",
      "Sho'rchi", "Termiz", "Uzun", "Termiz shahri",
    ],
  },
  {
    name: "Qoraqalpog'iston Respublikasi",
    districts: [
      "Amudaryo", "Beruniy", "Chimboy", "Ellikqal'a", "Kegeyli", "Mo'ynoq",
      "Nukus", "Qanliko'l", "Qo'ng'irot", "Qorao'zak", "Shumanay", "Taxtako'pir",
      "To'rtko'l", "Xo'jayli", "Bo'zatov", "Nukus shahri",
    ],
  },
];

/** District list for a region name (empty if the region is unknown/unset). */
export function districtsOf(region: string): string[] {
  return UZ_REGIONS.find((r) => r.name === region)?.districts ?? [];
}
