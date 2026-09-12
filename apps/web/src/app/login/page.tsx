import { AuthSplitLayout, LoginForm } from "@energy/ui";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <AuthSplitLayout
      productName="Energy Monitoring"
      tagline="Real-time energy monitoring for your building."
    >
      <LoginForm
        action={login}
        subheading="Sign in to your account to continue."
        emailPlaceholder="user@example.com"
        supportingText="Access is limited to authorized accounts."
      />
    </AuthSplitLayout>
  );
}
