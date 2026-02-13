/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as createDocument from "../createDocument.js";
import type * as deleteDocument from "../deleteDocument.js";
import type * as encryption from "../encryption.js";
import type * as getActivitiesFiltered from "../getActivitiesFiltered.js";
import type * as getAgents from "../getAgents.js";
import type * as getAuditLog from "../getAuditLog.js";
import type * as getDashboard from "../getDashboard.js";
import type * as getDocuments from "../getDocuments.js";
import type * as getMessages from "../getMessages.js";
import type * as getNotifications from "../getNotifications.js";
import type * as getTasksByStatus from "../getTasksByStatus.js";
import type * as heartbeat from "../heartbeat.js";
import type * as markNotificationDelivered from "../markNotificationDelivered.js";
import type * as updateDocument from "../updateDocument.js";
import type * as updateTaskStatus from "../updateTaskStatus.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  createDocument: typeof createDocument;
  deleteDocument: typeof deleteDocument;
  encryption: typeof encryption;
  getActivitiesFiltered: typeof getActivitiesFiltered;
  getAgents: typeof getAgents;
  getAuditLog: typeof getAuditLog;
  getDashboard: typeof getDashboard;
  getDocuments: typeof getDocuments;
  getMessages: typeof getMessages;
  getNotifications: typeof getNotifications;
  getTasksByStatus: typeof getTasksByStatus;
  heartbeat: typeof heartbeat;
  markNotificationDelivered: typeof markNotificationDelivered;
  updateDocument: typeof updateDocument;
  updateTaskStatus: typeof updateTaskStatus;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
