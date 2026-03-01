/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as addDocumentComment from "../addDocumentComment.js";
import type * as claimTask from "../claimTask.js";
import type * as completeTask from "../completeTask.js";
import type * as createDocument from "../createDocument.js";
import type * as createTask from "../createTask.js";
import type * as deleteDocument from "../deleteDocument.js";
import type * as encryption from "../encryption.js";
import type * as failTask from "../failTask.js";
import type * as generateUploadUrl from "../generateUploadUrl.js";
import type * as getActivitiesFiltered from "../getActivitiesFiltered.js";
import type * as getAgents from "../getAgents.js";
import type * as getAuditLog from "../getAuditLog.js";
import type * as getDashboard from "../getDashboard.js";
import type * as getDeadLetterQueue from "../getDeadLetterQueue.js";
import type * as getDocumentComments from "../getDocumentComments.js";
import type * as getDocuments from "../getDocuments.js";
import type * as getFileUrl from "../getFileUrl.js";
import type * as getMessages from "../getMessages.js";
import type * as getNotifications from "../getNotifications.js";
import type * as getPendingTasksForAgent from "../getPendingTasksForAgent.js";
import type * as getTaskById from "../getTaskById.js";
import type * as getTasksByStatus from "../getTasksByStatus.js";
import type * as getTasksWithMessages from "../getTasksWithMessages.js";
import type * as heartbeat from "../heartbeat.js";
import type * as markNotificationDelivered from "../markNotificationDelivered.js";
import type * as requestApproval from "../requestApproval.js";
import type * as requeueDeadLetter from "../requeueDeadLetter.js";
import type * as respondToApproval from "../respondToApproval.js";
import type * as sendMessage from "../sendMessage.js";
import type * as updateDocument from "../updateDocument.js";
import type * as updateTaskStatus from "../updateTaskStatus.js";
import type * as upsertAgent from "../upsertAgent.js";
import type * as writeTaskProgress from "../writeTaskProgress.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  addDocumentComment: typeof addDocumentComment;
  claimTask: typeof claimTask;
  completeTask: typeof completeTask;
  createDocument: typeof createDocument;
  createTask: typeof createTask;
  deleteDocument: typeof deleteDocument;
  encryption: typeof encryption;
  failTask: typeof failTask;
  generateUploadUrl: typeof generateUploadUrl;
  getActivitiesFiltered: typeof getActivitiesFiltered;
  getAgents: typeof getAgents;
  getAuditLog: typeof getAuditLog;
  getDashboard: typeof getDashboard;
  getDeadLetterQueue: typeof getDeadLetterQueue;
  getDocumentComments: typeof getDocumentComments;
  getDocuments: typeof getDocuments;
  getFileUrl: typeof getFileUrl;
  getMessages: typeof getMessages;
  getNotifications: typeof getNotifications;
  getPendingTasksForAgent: typeof getPendingTasksForAgent;
  getTaskById: typeof getTaskById;
  getTasksByStatus: typeof getTasksByStatus;
  getTasksWithMessages: typeof getTasksWithMessages;
  heartbeat: typeof heartbeat;
  markNotificationDelivered: typeof markNotificationDelivered;
  requestApproval: typeof requestApproval;
  requeueDeadLetter: typeof requeueDeadLetter;
  respondToApproval: typeof respondToApproval;
  sendMessage: typeof sendMessage;
  updateDocument: typeof updateDocument;
  updateTaskStatus: typeof updateTaskStatus;
  upsertAgent: typeof upsertAgent;
  writeTaskProgress: typeof writeTaskProgress;
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
