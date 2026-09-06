import nodemailer, { type Transporter } from "nodemailer";

import { env } from "../config/env.js";

export interface EmailDeliveryInput {
  fromEmail: string;
  fromName: string | null;
  recipient: string;
  subject: string;
  body: string;
}

export interface EmailDeliveryResult {
  messageId: string;
  previewUrl: string | null;
}

export interface EmailDeliveryClient {
  send(input: EmailDeliveryInput): Promise<EmailDeliveryResult>;
  close(): void;
}

type MailTransport = Pick<Transporter, "sendMail" | "close">;
type EtherealTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
};

export interface EtherealClientOptions {
  createTransport?: (options: EtherealTransportOptions) => MailTransport;
  getTestMessageUrl?: (info: { messageId: string }) => string | false | null;
}

export const createEtherealClient = (options: EtherealClientOptions = {}): EmailDeliveryClient => {
  if (!env.ETHEREAL_USER || !env.ETHEREAL_PASSWORD) {
    throw new Error(
      "ETHEREAL_USER and ETHEREAL_PASSWORD must be configured before starting the email worker.",
    );
  }

  const transportOptions = {
    host: env.ETHEREAL_HOST,
    port: env.ETHEREAL_PORT,
    secure: env.ETHEREAL_PORT === 465,
    auth: { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASSWORD },
  };
  const transporter =
    options.createTransport?.(transportOptions) ?? nodemailer.createTransport(transportOptions);

  return {
    async send(input) {
      const info = await transporter.sendMail({
        from: input.fromName ? { name: input.fromName, address: input.fromEmail } : input.fromEmail,
        to: input.recipient,
        subject: input.subject,
        text: input.body,
        html: input.body,
      });

      const previewUrl = options.getTestMessageUrl?.(info) ?? nodemailer.getTestMessageUrl(info);
      return {
        messageId: info.messageId,
        previewUrl: typeof previewUrl === "string" ? previewUrl : null,
      };
    },
    close() {
      transporter.close();
    },
  };
};
