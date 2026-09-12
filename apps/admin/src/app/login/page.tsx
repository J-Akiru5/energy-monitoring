import { AuthSplitLayout, LoginForm } from "@energy/ui";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <AuthSplitLayout
      productName="Admin Portal"
      tagline="Authenticate to access the monitoring dashboard."
    >
      <LoginForm
        action={login}
        subheading="Sign in to the admin console."
        emailPlaceholder="admin@isufst.edu.ph"
        supportingText="Restricted access. Activity is logged."
      />
    </AuthSplitLayout>
  );
}
