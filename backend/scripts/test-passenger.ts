import type { Passenger } from "../src/schemas/flight-booking.js";

const NAMES = {
  firstNames: {
    male: ["Chukwuemeka", "Oluwaseun", "Adebayo", "Ikechukwu", "Tunde", "Emeka", "Obinna", "Chibueze", "Femi", "Tobi", "Damilola", "Yusuf", "Kelechi", "Chinedu", "Babatunde", "Nnamdi", "Uche", "Segun", "Abubakar", "Adeolu"],
    female: ["Chidinma", "Oluwabunmi", "Adaeze", "Ngozi", "Funke", "Chiamaka", "Blessing", "Amina", "Ifeoma", "Titilayo", "Nneka", "Folake", "Yetunde", "Zainab", "Obiageli", "Bukola", "Halima", "Nkechi", "Aisha", "Ebele"]
  },
  middleNames: {
    male: ["Ifeanyi", "Oluwatobi", "Chukwudi", "Adewale", "Nonso", "Olumide", "Tochukwu", "Ayodeji", "Ugochukwu", "Kayode"],
    female: ["Onyinyechi", "Oluwakemi", "Adaugo", "Omotola", "Uchenna", "Oluwaseyi", "Chisom", "Adetola", "Nkemdilim", "Omolara"]
  },
  lastNames: ["Okonkwo", "Adeyemi", "Okafor", "Ibrahim", "Eze", "Abubakar", "Nwosu", "Balogun", "Obi", "Adekunle", "Uzoma", "Olawale", "Nwachukwu", "Fashola", "Okoro", "Adeleke", "Chukwuma", "Ogundimu", "Usman", "Onyeka"]
};

const PHONE_PREFIXES = ["0803", "0805", "0806", "0807", "0808", "0810", "0811", "0812", "0813", "0814", "0815", "0816", "0817", "0818", "0909", "0908"];
const EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "mail.com"];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function randomDOB(): string {
  const year = 1975 + Math.floor(Math.random() * 30);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function randomPhone(): string {
  return pick(PHONE_PREFIXES) + String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
}

function randomEmail(firstName: string, lastName: string): string {
  const sep = pick([".", "_", ""]);
  const num = Math.random() > 0.5 ? String(Math.floor(Math.random() * 99)) : "";
  return `${firstName.toLowerCase()}${sep}${lastName.toLowerCase()}${num}@${pick(EMAIL_DOMAINS)}`;
}

export function generateTestPassenger(email?: string, gender?: "Male" | "Female"): Passenger {
  const g = gender ?? (Math.random() > 0.5 ? "Male" : "Female");
  const gKey = g.toLowerCase() as "male" | "female";
  const firstName = pick(NAMES.firstNames[gKey]);
  const lastName = pick(NAMES.lastNames);
  return {
    title: g === "Male" ? "Mr" : pick(["Ms", "Mrs", "Miss"]),
    firstName,
    lastName,
    middleName: pick(NAMES.middleNames[gKey]),
    dateOfBirth: randomDOB(),
    nationality: "Nigerian",
    gender: g,
    phone: randomPhone(),
    email: email ?? randomEmail(firstName, lastName)
  };
}
