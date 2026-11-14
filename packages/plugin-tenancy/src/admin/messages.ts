import { defineMessages } from "@quickben/admin/i18n";

import type { ResolvedTenancy } from "../options";
import type { AdminI18n } from "@quickben/admin";
import type { MessageKey, Translator } from "@quickben/admin/i18n";

/**
 * Messages of the tenancy admin, namespace `tenancy`. Override any of them with
 * `admin.messages` in the config: `{ es: { "tenancy.nav.members": "Equipo" } }`.
 */
export const tenancyMessages = defineMessages("tenancy", {
  en: {
    "nav.group": "Organization",
    "nav.members": "Members",
    "nav.organization": "Organization settings",

    "switcher.label": "Active organization",
    "switcher.choose": "Choose…",
    "switcher.all": "All organizations",
    "switcher.option": "{name} ({role})",
    "switcher.submit": "Switch",
    "switcher.empty": "No organization yet.",
    "switcher.create": "Create one",

    "role.owner": "Owner",
    "role.admin": "Admin",
    "role.member": "Member",
    "role.viewer": "Viewer",
    "status.invited": "Invited",
    "status.active": "Active",
    "status.disabled": "Disabled",
    "status.suspended": "Suspended",

    "notice.signIn": "Sign in to manage an organization.",
    "notice.choose": "Choose an organization in the sidebar.",
    "notice.none": "You do not belong to any organization. Create one or ask to be invited.",
    "notice.problem": "{problem} {hint}",

    "members.title": "Members",
    "members.description": "People in the active organization.",
    "members.descriptionOf":
      "People in {organization}. No module ticked means every module of the organization.",
    "members.you": "(you)",
    "members.column.member": "Member",
    "members.column.role": "Role",
    "members.column.status": "Status",
    "members.column.modules": "Modules",
    "members.column.actions": "Actions",
    "members.roleOf": "Role of {who}",
    "members.statusOf": "Status of {who}",
    "members.modulesOf": "Modules of {who}",
    "members.allModules": "All",
    "members.save": "Save",
    "members.remove": "Remove",
    "members.removeWho": "Remove {who}",
    "members.column.details": "Details",
    "members.details": "Details",
    "members.detailsOf": "Details of {who}",
    "members.saveDetails": "Save details",
    "members.close": "Close",
    "invite.title": "Invite a member",
    "invite.description":
      "An email address or a user id. The invitation is pending until they accept it.",
    "invite.invitee": "Email or user id",
    "invite.role": "Role",
    "invite.submit": "Invite",

    "organization.title": "Organization",
    "organization.description": "Name, status and modules of the active organization.",
    "settings.title": "Settings",
    "settings.readOnly": "Your role cannot change these settings.",
    "settings.name": "Name",
    "settings.slug": "Slug",
    "settings.status": "Status",
    "settings.modules": "Modules",
    "settings.statusAndModules": "Status and modules",
    "settings.platformOnly": "Set by platform staff.",
    "settings.save": "Save settings",
    "settings.general": "General",
    "settings.sections": "Settings sections",
    "settings.unknownSection": "That settings section does not exist.",
    "settings.moduleUntil": "until {date}",
    "settings.moduleExpired": "expired",
    "create.title": "New organization",
    "create.description": "You become its owner.",
    "create.slugPlaceholder": "acme-inc",
    "create.submit": "Create organization",

    "toast.invited": "Invitation created",
    "toast.member-updated": "Member updated",
    "toast.member-removed": "Member removed",
    "toast.organization-saved": "Organization saved",
    "toast.organization-created": "Organization created",

    "error.unauthorized": "Sign in again to continue.",
    "error.forbidden": "You are not allowed to do that.",
    "error.not-found": "That item does not exist or you cannot see it.",
    "error.invalid": "Some values are not valid. Check the form and try again.",
    "error.invalid-slug": "Use lowercase letters, digits and -, e.g. acme-inc.",
    "error.slug-taken": "That slug is already used by another organization.",
    "error.already-member": "That person is already a member or has an invitation.",
    "error.conflict": "That value is already used.",
    "error.organization-none": "Choose an organization first.",
    "error.organization-ambiguous": "You belong to several organizations. Choose one.",
    "error.organization-not-member": "You are not a member of that organization.",
    "error.organization-unknown": "That organization does not exist.",
    "error.organization-suspended": "That organization is suspended.",
    "error.organization-inactive": "That organization is not open right now.",
    "error.last-owner":
      "An organization needs at least one active owner. Make someone else owner first.",
    "error.own-role": "You cannot change your own role or status. Ask another owner or admin.",
    "error.own-membership":
      "You cannot remove your own owner or admin membership. Ask another owner or admin.",
    "error.higher-role": "Only a higher role can manage that role.",
    "error.platform-only": "Only platform staff can change modules or status.",
    "error.not-empty": "The organization still has data. Delete it first.",
    "error.failed": "The change could not be saved.",
  },
  es: {
    "nav.group": "Organización",
    "nav.members": "Miembros",
    "nav.organization": "Ajustes de la organización",

    "switcher.label": "Organización activa",
    "switcher.choose": "Elige…",
    "switcher.all": "Todas las organizaciones",
    "switcher.option": "{name} ({role})",
    "switcher.submit": "Cambiar",
    "switcher.empty": "Aún no tienes una organización.",
    "switcher.create": "Crear una",

    "role.owner": "Propietario",
    "role.admin": "Administrador",
    "role.member": "Miembro",
    "role.viewer": "Lector",
    "status.invited": "Invitado",
    "status.active": "Activo",
    "status.disabled": "Desactivado",
    "status.suspended": "Suspendido",

    "notice.signIn": "Inicia sesión para administrar una organización.",
    "notice.choose": "Elige una organización en la barra lateral.",
    "notice.none": "No perteneces a ninguna organización. Crea una o pide que te inviten.",
    "notice.problem": "{problem} {hint}",

    "members.title": "Miembros",
    "members.description": "Personas de la organización activa.",
    "members.descriptionOf":
      "Personas de {organization}. Sin módulos marcados, tiene acceso a todos los módulos de la organización.",
    "members.you": "(tú)",
    "members.column.member": "Miembro",
    "members.column.role": "Rol",
    "members.column.status": "Estado",
    "members.column.modules": "Módulos",
    "members.column.actions": "Acciones",
    "members.roleOf": "Rol de {who}",
    "members.statusOf": "Estado de {who}",
    "members.modulesOf": "Módulos de {who}",
    "members.allModules": "Todos",
    "members.save": "Guardar",
    "members.remove": "Quitar",
    "members.removeWho": "Quitar a {who}",
    "members.column.details": "Detalles",
    "members.details": "Detalles",
    "members.detailsOf": "Detalles de {who}",
    "members.saveDetails": "Guardar detalles",
    "members.close": "Cerrar",
    "invite.title": "Invitar a un miembro",
    "invite.description":
      "Un correo o un id de usuario. La invitación queda pendiente hasta que la acepte.",
    "invite.invitee": "Correo o id de usuario",
    "invite.role": "Rol",
    "invite.submit": "Invitar",

    "organization.title": "Organización",
    "organization.description": "Nombre, estado y módulos de la organización activa.",
    "settings.title": "Ajustes",
    "settings.readOnly": "Tu rol no puede cambiar estos ajustes.",
    "settings.name": "Nombre",
    "settings.slug": "Slug",
    "settings.status": "Estado",
    "settings.modules": "Módulos",
    "settings.statusAndModules": "Estado y módulos",
    "settings.platformOnly": "Lo define el equipo de la plataforma.",
    "settings.save": "Guardar ajustes",
    "settings.general": "General",
    "settings.sections": "Secciones de ajustes",
    "settings.unknownSection": "Esa sección de ajustes no existe.",
    "settings.moduleUntil": "hasta el {date}",
    "settings.moduleExpired": "vencido",
    "create.title": "Nueva organización",
    "create.description": "Serás su propietario.",
    "create.slugPlaceholder": "acme-inc",
    "create.submit": "Crear organización",

    "toast.invited": "Invitación creada",
    "toast.member-updated": "Miembro actualizado",
    "toast.member-removed": "Miembro quitado",
    "toast.organization-saved": "Organización guardada",
    "toast.organization-created": "Organización creada",

    "error.unauthorized": "Vuelve a iniciar sesión para continuar.",
    "error.forbidden": "No tienes permiso para hacer eso.",
    "error.not-found": "Ese elemento no existe o no puedes verlo.",
    "error.invalid": "Algunos valores no son válidos. Revisa el formulario e inténtalo de nuevo.",
    "error.invalid-slug": "Usa minúsculas, dígitos y -, por ejemplo acme-inc.",
    "error.slug-taken": "Otra organización ya usa ese slug.",
    "error.already-member": "Esa persona ya es miembro o tiene una invitación.",
    "error.conflict": "Ese valor ya está en uso.",
    "error.organization-none": "Primero elige una organización.",
    "error.organization-ambiguous": "Perteneces a varias organizaciones. Elige una.",
    "error.organization-not-member": "No eres miembro de esa organización.",
    "error.organization-unknown": "Esa organización no existe.",
    "error.organization-suspended": "Esa organización está suspendida.",
    "error.organization-inactive": "Esa organización no está disponible por ahora.",
    "error.last-owner":
      "Una organización necesita al menos un propietario activo. Primero haz propietario a otra persona.",
    "error.own-role":
      "No puedes cambiar tu propio rol o estado. Pídeselo a otro propietario o administrador.",
    "error.own-membership":
      "No puedes quitar tu propia membresía de propietario o administrador. Pídeselo a otro propietario o administrador.",
    "error.higher-role": "Solo un rol superior puede administrar ese rol.",
    "error.platform-only": "Solo el equipo de la plataforma puede cambiar los módulos o el estado.",
    "error.not-empty": "La organización aún tiene datos. Elimínalos primero.",
    "error.failed": "No se pudo guardar el cambio.",
  },
});

/** Translate function of the tenancy messages. */
export type TenancyT = Translator<MessageKey<typeof tenancyMessages>>["t"];

const roleKeys: Readonly<Record<string, MessageKey<typeof tenancyMessages>>> = {
  owner: "role.owner",
  admin: "role.admin",
  member: "role.member",
  viewer: "role.viewer",
};

const statusKeys: Readonly<Record<string, MessageKey<typeof tenancyMessages>>> = {
  invited: "status.invited",
  active: "status.active",
  disabled: "status.disabled",
  suspended: "status.suspended",
};

/** Label of a role: the catalog message for the default roles, else the configured name. */
export function roleLabel(t: TenancyT, role: string): string {
  const key = Object.hasOwn(roleKeys, role) ? roleKeys[role] : undefined;
  return key ? t(key) : role;
}

/** Label of a membership or organization status. Unknown statuses show as stored. */
export function statusLabel(t: TenancyT, status: string): string {
  const key = Object.hasOwn(statusKeys, status) ? statusKeys[status] : undefined;
  return key ? t(key) : status;
}

/** Label of an organization status: its configured `label`, else {@link statusLabel}. */
export function organizationStatusLabel(
  t: TenancyT,
  i18n: AdminI18n,
  tenancy: ResolvedTenancy,
  status: string,
): string {
  const label = tenancy.statuses.find((s) => s.name === status)?.label;
  return label === undefined ? statusLabel(t, status) : i18n.text(label);
}
