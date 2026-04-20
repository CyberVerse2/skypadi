import { z } from "zod";

export const passengerSchema = z.object({
  title: z.enum(["Mr", "Ms", "Mrs", "Miss", "Sir", "Dr"]),
  firstName: z.string().trim().min(2).max(50),
  lastName: z.string().trim().min(2).max(50),
  middleName: z.string().trim().max(50).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  nationality: z.string().trim().default("Nigerian"),
  gender: z.enum(["Male", "Female"]),
  phone: z.string().trim().min(7).max(20),
  email: z.string().email()
});

export type Passenger = z.infer<typeof passengerSchema>;
