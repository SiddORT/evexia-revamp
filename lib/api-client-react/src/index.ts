export * from "./generated/api";
export * from "./generated/api.schemas";
export { getHealthCheck as healthCheck } from "./generated/api";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
export * from "./mr-dashboard-generated/dashboard";
export type {
  MRDashboardReport,
  MRDashboardAchievement,
  MRDashboardCount,
  MRDashboardDirectory,
  MRDashboardMonth,
  MRDashboardRecentOrder,
  MRDashboardTypeCount,
  MrDashboardParams,
  MRDoctorPayment,
  MRDoctorPaymentsPage,
  MrDoctorPaymentsParams,
} from "./mr-dashboard-generated/dashboard.schemas";
