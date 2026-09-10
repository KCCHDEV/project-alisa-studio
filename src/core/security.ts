/**
 * ASTSecurityGatekeeper - Security and Secret Leakage Prevention for Ichigo Agent
 */

export interface SecurityPolicy {
  blockDangerousCommands: boolean;
  preventSecretLeakage: boolean;
  blockedPatterns: RegExp[];
  secretPatterns: RegExp[];
}

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  sanitizedContent?: string;
}

export class ASTSecurityGatekeeper {
  private policy: SecurityPolicy;

  constructor(customPolicy?: Partial<SecurityPolicy>) {
    this.policy = {
      blockDangerousCommands: customPolicy?.blockDangerousCommands ?? true,
      preventSecretLeakage: customPolicy?.preventSecretLeakage ?? true,
      blockedPatterns: [
        /\brm\s+-(rf|fr)\s+[\/\\]/i, // rm -rf /
        /\bformat\s+[a-z]:/i,       // format c:
        /\bdel\s+\/[sfq]\s+c:\\/i,   // del /s /q c:\
        /\bshutdown(\.exe)?\s+/i,   // shutdown
        /\bdd\s+if=.*of=\/dev\//i,  // dd wipe
      ],
      secretPatterns: [
        /(?:sk-[a-zA-Z0-9_-]{32,})/i,             // OpenAI / OpenRouter sk- keys
        /(?:ghp_[a-zA-Z0-9]{36})/i,              // GitHub PAT
        /(?:xox[baprs]-[0-9a-zA-Z]{10,48})/i,     // Slack Tokens
        /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, // RSA Private Keys
      ],
      ...customPolicy,
    };
  }

  /**
   * Audit terminal shell commands before execution
   */
  auditTerminalCommand(command: string): SecurityCheckResult {
    if (!this.policy.blockDangerousCommands) {
      return { allowed: true };
    }

    for (const pattern of this.policy.blockedPatterns) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: `[Security Policy] บล็อกคำสั่งอันตราย (${command.slice(0, 40)}...) เพื่อความปลอดภัยของระบบ`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Audit file writes to prevent saving hardcoded production secrets
   */
  auditFileWrite(filePath: string, content: string): SecurityCheckResult {
    if (!this.policy.preventSecretLeakage) {
      return { allowed: true };
    }

    // Skip environment configuration files (.env, .ichigo-config.json) which are intended to hold keys
    const isEnvOrConfig = /\.(env|json|yaml|yml)$/i.test(filePath) || filePath.includes('config');
    if (isEnvOrConfig) {
      return { allowed: true };
    }

    for (const pattern of this.policy.secretPatterns) {
      if (pattern.test(content)) {
        return {
          allowed: false,
          reason: `[Security Policy] ตรวจพบคีย์ลับหรือ API Token ในโค้ด (${filePath}) โปรดใช้ Environment Variable แทนการ Hardcode`,
        };
      }
    }

    return { allowed: true };
  }
}
