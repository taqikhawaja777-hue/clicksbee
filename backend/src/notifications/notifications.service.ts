import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRecipientType, NotificationType, Role } from '@prisma/client';
import { MonitorGateway } from '../monitor/monitor.gateway';

/**
 * "Management tier" (can message anyone, including broadcasting to All
 * Employees, and can reach down to floor-tier employees) vs "floor tier"
 * (can only message other floor-tier employees, one at a time).
 *
 * Designation is the primary signal, NOT backend role - CSR is created
 * via the Manager signup tab (backend role ADMIN, for Manager-portal UI
 * access) but must still be floor tier for MESSAGING, same tier as Team
 * Lead, so "CSR and Team Lead message each other as peers" keeps holding
 * regardless of which signup tab produced the account. Only an account
 * with NO designation at all (a plain admin/manager, e.g. the CEO) falls
 * back to backend role.
 */
export function isManagementTier(role: Role, designation?: string | null): boolean {
  if (designation === 'SM' || designation === 'HR') return true;
  if (designation === 'CSR' || designation === 'Team Lead' || designation === 'Employee') return false;
  return role === Role.ADMIN || role === Role.MANAGER;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitorGateway: MonitorGateway,
  ) {}

  // ---- creation --------------------------------------------------------

  /**
   * System-generated notification (check-in, check-out, idle alert,
   * compliance flag, task events, etc.) - sender is always 'system'.
   * recipientType ADMIN means every manager/admin in the org (userId left
   * null); EMPLOYEE means exactly one user (recipientUserId required).
   * Broadcasts over Socket.IO immediately after the write so the badge/
   * feed update in real time, not just on next page load.
   */
  async createSystemNotification(params: {
    organizationId: string;
    recipientType: NotificationRecipientType;
    type: NotificationType;
    title: string;
    message: string;
    recipientUserId?: string | null;
    metadata?: any;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        recipientType: params.recipientType,
        userId: params.recipientType === NotificationRecipientType.EMPLOYEE ? params.recipientUserId ?? null : null,
        sender: 'system',
        type: params.type,
        title: params.title,
        message: params.message,
        metadata: params.metadata || {},
      },
    });
    this.monitorGateway.emitNotification(notification as any);
    return notification;
  }

  /**
   * Admin-authored message via the "Send Notification" feature - one row
   * per targeted employee (not a single null-recipient broadcast row), so
   * every existing per-user read/scoping query below needs no special
   * casing for "sent to everyone". "sender" is the admin's own User id, so
   * it's traceable to who actually sent it, not just 'system'.
   */
  async sendManualNotification(
    organizationId: string,
    senderUserId: string,
    recipientUserIds: string[],
    title: string,
    message: string,
    attachmentUrl?: string,
    attachmentName?: string,
  ) {
    if (recipientUserIds.length === 0) {
      throw new NotFoundException('No matching recipients found for this notification');
    }

    const created = await Promise.all(
      recipientUserIds.map((userId) =>
        this.prisma.notification.create({
          data: {
            organizationId,
            recipientType: NotificationRecipientType.EMPLOYEE,
            userId,
            sender: senderUserId,
            type: NotificationType.MANUAL_MESSAGE,
            title,
            message,
            attachmentUrl: attachmentUrl || undefined,
            attachmentName: attachmentName || undefined,
            metadata: {},
          },
        }),
      ),
    );

    created.forEach((notification) => this.monitorGateway.emitNotification(notification as any));
    return created;
  }

  // ---- reads, scoped by role AT THE QUERY LEVEL -------------------------
  //
  // An EMPLOYEE's where-clause can only ever match rows addressed to
  // their own verified userId (from the JWT via @CurrentUser, never a
  // client-supplied param) - there is no code path where passing a
  // different id, a different recipientType, or any query string can
  // widen this. An ADMIN/MANAGER's where-clause can only ever match the
  // org-wide ADMIN-scoped shared inbox - never another employee's
  // personal EMPLOYEE-scoped rows, and never another organization's data.

  private scopedWhere(userId: string, organizationId: string, role: Role) {
    if (role === Role.EMPLOYEE) {
      return { organizationId, recipientType: NotificationRecipientType.EMPLOYEE, userId };
    }
    return { organizationId, recipientType: NotificationRecipientType.ADMIN };
  }

  async getNotifications(userId: string, organizationId: string, role: Role, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = this.scopedWhere(userId, organizationId, role);
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUnreadCount(userId: string, organizationId: string, role: Role) {
    const where = { ...this.scopedWhere(userId, organizationId, role), isRead: false };
    const count = await this.prisma.notification.count({ where });
    return { count };
  }

  async markAsRead(id: string, userId: string, organizationId: string, role: Role) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.organizationId !== organizationId) {
      throw new NotFoundException('Notification not found');
    }

    const isMine =
      role === Role.EMPLOYEE
        ? notification.recipientType === NotificationRecipientType.EMPLOYEE && notification.userId === userId
        : notification.recipientType === NotificationRecipientType.ADMIN;
    if (!isMine) {
      // Deliberately NotFound rather than Forbidden - doesn't confirm to
      // the caller that a notification with this id exists at all for
      // someone else's inbox.
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /**
   * Every messageable person in the org for the "Send Message" composer's
   * recipient dropdown - deliberately NOT the same list as
   * EmployeesService.getAllRegisteredEmployees(), which hardcodes
   * `role: 'EMPLOYEE'` and would silently exclude every CSR/HR/SM account
   * (those sign up via the Manager tab, backend role ADMIN, for
   * Manager-portal UI access) from ever appearing as a recipient. Includes
   * everyone in the org except the requester themselves; which of these
   * candidates a given sender may actually message is still enforced by
   * sendNotification()'s tier check, not by this list.
   */
  async getMessageableUsers(organizationId: string, excludeUserId: string) {
    return this.prisma.user.findMany({
      where: { organizationId, id: { not: excludeUserId } },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, designation: true },
      orderBy: { firstName: 'asc' },
    });
  }

  async markAllAsRead(userId: string, organizationId: string, role: Role) {
    const where = { ...this.scopedWhere(userId, organizationId, role), isRead: false };
    return this.prisma.notification.updateMany({ where, data: { isRead: true, readAt: new Date() } });
  }

  // ---- internal bridge (called by productivity_service, not a browser) --

  /**
   * One check-in/check-out/idle-alert/etc. event in productivity_service
   * can produce up to two rows: an ADMIN-scoped one ("Ayesha Khan checked
   * in at 9:02 AM", for every manager) and, if employeeMessage is given,
   * an EMPLOYEE-scoped one for the same person ("You checked in
   * successfully") - two different audiences for the same real event,
   * not a duplicate. Resolves the productivity_service employee's email to
   * a real MongoDB User the same way the frontend already does elsewhere
   * (email is the only key shared between the two backends' separate id
   * spaces) - done here, server-side, with an exact match rather than the
   * frontend's fuzzy name-includes fallback.
   */
  async recordSystemEvent(params: {
    employeeEmail: string;
    type: NotificationType;
    adminTitle: string;
    adminMessage: string;
    employeeTitle?: string;
    employeeMessage?: string;
    metadata?: any;
  }) {
    const user = await this.prisma.user.findFirst({ where: { email: params.employeeEmail.toLowerCase() } });
    if (!user) {
      throw new NotFoundException(`No User found for email ${params.employeeEmail} - cannot attribute this event`);
    }

    const results: any[] = [];

    results.push(
      await this.createSystemNotification({
        organizationId: user.organizationId,
        recipientType: NotificationRecipientType.ADMIN,
        type: params.type,
        title: params.adminTitle,
        message: params.adminMessage,
        metadata: params.metadata,
      }),
    );

    if (params.employeeMessage) {
      results.push(
        await this.createSystemNotification({
          organizationId: user.organizationId,
          recipientType: NotificationRecipientType.EMPLOYEE,
          recipientUserId: user.id,
          type: params.type,
          title: params.employeeTitle || params.adminTitle,
          message: params.employeeMessage,
          metadata: params.metadata,
        }),
      );
    }

    return results;
  }
}
