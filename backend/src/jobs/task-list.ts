import type { TaskList } from "graphile-worker";

import { supplierBookingTaskName } from "./booking-queue";
import { supplierBookingTask } from "./tasks/supplier-booking.task";

export const taskList: TaskList = {
  [supplierBookingTaskName]: supplierBookingTask,
};
