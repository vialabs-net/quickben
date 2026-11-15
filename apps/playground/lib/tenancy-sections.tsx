import { Button, Card, CardBody, CardHeader, Input, Label } from "@quickben/admin/ui";

import { saveContact } from "@/app/tenancy/contact-action";

import type { OrganizationSection, OrganizationSectionProps } from "@quickben/plugin-tenancy/admin";

/** A custom settings section: a server component with its own server action. */
function ContactSection({
  organization,
  tenant,
  basePath,
  searchParams,
}: Readonly<OrganizationSectionProps>) {
  const canEdit = tenant.capabilities.includes("organization:manage");
  const saved = searchParams.saved === "1";
  return (
    <Card>
      <CardHeader title="Contact" description="Who we write to about this organization." />
      <CardBody>
        <form action={saveContact} className="qb:space-y-4">
          <input type="hidden" name="back" value={`${basePath}/organization/contact`} />
          <div className="qb:space-y-1.5">
            <Label htmlFor="contact-email">Contact email</Label>
            <Input
              id="contact-email"
              name="contactEmail"
              type="email"
              defaultValue={
                typeof organization.contactEmail === "string" ? organization.contactEmail : ""
              }
              disabled={!canEdit}
            />
          </div>
          {canEdit ? <Button type="submit">Save contact</Button> : null}
          {saved ? <p role="status">Contact saved</p> : null}
        </form>
      </CardBody>
    </Card>
  );
}

/** Extra tabs of the Organization settings page, in the full and the embedded admin. */
export const organizationSections: OrganizationSection[] = [
  { key: "contact", label: { en: "Contact", es: "Contacto" }, component: ContactSection },
];
