import { AuthSplitLayout, LoginForm } from "@energy/ui";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <AuthSplitLayout
      productName="Super Admin"
      tagline="Manage tenants, users, and system settings for Syntaxure Labs."
    >
      <LoginForm
        action={login}
        subheading="Sign in with a super-admin account."
        emailPlaceholder="admin@syntaxure.dev"
        supportingText="Access is limited to authorized accounts."
      />
    </AuthSplitLayout>
  );
}
