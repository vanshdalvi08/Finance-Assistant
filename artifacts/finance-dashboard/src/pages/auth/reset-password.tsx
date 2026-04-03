import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/auth/auth-service";
import { useToast } from "@/hooks/use-toast";

const resetSchema = z
  .object({
    token: z.string().min(8),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const initialToken = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      token: initialToken,
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: z.infer<typeof resetSchema>) {
    setIsLoading(true);

    try {
      await resetPassword({ token: values.token, password: values.password });
      toast({
        title: "Password updated",
        description: "You can now sign in with your new password.",
      });
      setLocation("/login");
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-[420px] border-border/50 shadow-lg bg-card/50 backdrop-blur-sm">
        <CardHeader className="space-y-4">
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            Use the token from your email link to set a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="token"
                render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reset token</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Paste token from email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm new password</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                )}
              />
              <Button className="w-full" size="lg" type="submit" disabled={isLoading}>
                {isLoading ? "Updating..." : "Update password"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
