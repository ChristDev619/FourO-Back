# ENS (Esquema Nacional de Seguridad) Compliance Analysis

## Executive Summary

This document provides a comprehensive analysis of your Azure-hosted application's current security posture and identifies areas that need alignment with the **Esquema Nacional de Seguridad (ENS)** - Spain's National Security Scheme. ENS is a mandatory cybersecurity framework for systems handling information for Spanish public administration.

---

## Part 1: Current Security Assessment

### ✅ **Strengths Found in Your Codebase**

1. **Authentication & Authorization**
   - JWT-based authentication implemented
   - Role-based access control (admin/user roles)
   - Password hashing using bcrypt (10 rounds)
   - Email verification system
   - Password reset functionality

2. **Logging & Monitoring**
   - Comprehensive logging with Winston
   - Correlation ID tracking for request tracing
   - Azure Application Insights integration
   - Error tracking and notification service
   - Request/response logging with correlation context

3. **Database Security**
   - SSL/TLS connections to MySQL database
   - Connection pooling configured
   - Environment variables for sensitive data

4. **API Security**
   - CORS configuration
   - Rate limiting on bulk operations
   - Input validation middleware
   - Request timeout handling

5. **Infrastructure**
   - Azure-hosted (good for compliance)
   - Front Door integration
   - Redis for caching/queues
   - WebSocket support with proper handling

### ⚠️ **Security Gaps Identified**

1. **Critical Issues**
   - **Hardcoded secrets in `env-vars.json`** (passwords, JWT secrets visible in codebase)
   - **JWT token expiration too short** (1 hour) - may need refresh tokens
   - **Inconsistent JWT secret usage** (`JWT_SECRET` vs `SECRET` in different places)
   - **No security headers** (HSTS, CSP, X-Frame-Options, etc.)
   - **Password policy weak** (minimum 6 characters only)
   - **No account lockout mechanism** after failed login attempts
   - **No session management** (no logout/token revocation)

2. **Medium Priority Issues**
   - **Input sanitization** - Limited validation, no SQL injection protection visible
   - **No rate limiting** on authentication endpoints
   - **No audit trail** for sensitive operations (user creation, role changes)
   - **No data encryption at rest** documentation
   - **No backup/disaster recovery** procedures documented
   - **No security incident response plan**
   - **No security headers middleware** (helmet.js not found)

3. **Compliance Gaps**
   - **No security policy documentation**
   - **No access control matrix** documented
   - **No data classification** (public, internal, confidential)
   - **No privacy policy** or data protection measures documented
   - **No security training** records
   - **No vulnerability management** process

---

## Part 2: ENS Requirements Checklist for Azure-Hosted Applications

### **Category 1: Governance & Organization**

- [ ] **Security Policy Document** - Define and document security policies
- [ ] **Roles & Responsibilities** - Assign security roles (CISO, security officer, etc.)
- [ ] **Risk Management** - Implement risk assessment and management process
- [ ] **Security Training** - Provide security awareness training to staff
- [ ] **Incident Response Plan** - Document and test incident response procedures
- [ ] **Business Continuity Plan** - Document disaster recovery and backup procedures
- [ ] **Vendor Management** - Security requirements for third-party services (Azure, etc.)

### **Category 2: Access Control**

- [ ] **User Identification** - Unique user identification system ✅ (username)
- [ ] **Authentication** - Strong authentication mechanisms ✅ (JWT + bcrypt)
- [ ] **Password Policy** - Enforce strong password requirements ⚠️ (needs improvement)
- [ ] **Account Management** - User account lifecycle management ✅ (create/update/delete)
- [ ] **Access Control Matrix** - Document who can access what
- [ ] **Privileged Access** - Special controls for admin accounts ⚠️ (partial)
- [ ] **Session Management** - Session timeout and logout ⚠️ (missing)
- [ ] **Multi-Factor Authentication (MFA)** - For sensitive operations ❌ (not implemented)

### **Category 3: Cryptography**

- [ ] **Encryption in Transit** - TLS/SSL for all communications ✅ (HTTPS, DB SSL)
- [ ] **Encryption at Rest** - Encrypt sensitive data at rest ⚠️ (needs verification)
- [ ] **Key Management** - Secure key storage and rotation ⚠️ (secrets in env vars)
- [ ] **Cryptographic Algorithms** - Use approved algorithms ✅ (bcrypt, AES)
- [ ] **Certificate Management** - Proper SSL certificate handling ✅ (Azure managed)

### **Category 4: System & Network Security**

- [ ] **Network Segmentation** - Isolate critical systems
- [ ] **Firewall Rules** - Configure network security groups ✅ (Azure NSG)
- [ ] **Intrusion Detection** - Monitor for security threats ⚠️ (partial - Application Insights)
- [ ] **Vulnerability Management** - Regular security scanning and patching
- [ ] **System Hardening** - Secure configuration of servers ✅ (Docker container)
- [ ] **Backup & Recovery** - Regular backups and tested recovery ⚠️ (needs documentation)

### **Category 5: Application Security**

- [ ] **Input Validation** - Validate and sanitize all inputs ⚠️ (partial)
- [ ] **Output Encoding** - Prevent XSS attacks ⚠️ (needs verification)
- [ ] **SQL Injection Protection** - Use parameterized queries ✅ (Sequelize ORM)
- [ ] **Security Headers** - Implement security HTTP headers ❌ (missing)
- [ ] **Error Handling** - Don't expose sensitive info in errors ⚠️ (needs review)
- [ ] **API Security** - Rate limiting, authentication on all endpoints ⚠️ (partial)
- [ ] **Dependency Management** - Keep dependencies updated ⚠️ (needs process)

### **Category 6: Logging & Monitoring**

- [ ] **Audit Logging** - Log all security-relevant events ✅ (Winston logger)
- [ ] **Log Retention** - Retain logs for required period ✅ (file rotation)
- [ ] **Log Protection** - Protect logs from tampering ⚠️ (needs review)
- [ ] **Security Monitoring** - Real-time security event monitoring ⚠️ (Application Insights)
- [ ] **Alerting** - Alert on security incidents ⚠️ (error notification service)
- [ ] **Correlation** - Link related events ✅ (correlation IDs)

### **Category 7: Data Protection**

- [ ] **Data Classification** - Classify data by sensitivity
- [ ] **Data Retention** - Define data retention policies
- [ ] **Data Deletion** - Secure data deletion procedures
- [ ] **Privacy Policy** - Document data handling practices
- [ ] **GDPR Compliance** - If handling EU personal data
- [ ] **Data Backup** - Regular encrypted backups ⚠️ (needs documentation)

### **Category 8: Incident Management**

- [ ] **Incident Response Plan** - Documented procedures
- [ ] **Incident Detection** - Mechanisms to detect incidents ⚠️ (partial)
- [ ] **Incident Reporting** - Report to authorities if required
- [ ] **Forensics** - Preserve evidence for investigation
- [ ] **Post-Incident Review** - Learn from incidents

---

## Part 3: Specific ENS Requirements That Apply to Your Application

### **High Priority - Must Implement**

1. **Security Headers Middleware**
   ```javascript
   // Install: npm install helmet
   // Add to index.js:
   const helmet = require('helmet');
   app.use(helmet());
   ```
   - Implements HSTS, CSP, X-Frame-Options, etc.
   - **Status**: ❌ Missing

2. **Enhanced Password Policy**
   - Minimum 12 characters (ENS recommendation)
   - Require uppercase, lowercase, numbers, special characters
   - Password history (prevent reuse)
   - **Current**: Only 6 characters minimum
   - **Status**: ⚠️ Needs improvement

3. **Account Lockout Mechanism**
   - Lock account after 5 failed login attempts
   - Lock duration: 30 minutes
   - **Status**: ❌ Missing

4. **Session Management**
   - Implement refresh tokens
   - Token revocation on logout
   - Session timeout configuration
   - **Current**: JWT expires in 1 hour, no refresh mechanism
   - **Status**: ⚠️ Needs improvement

5. **Security Audit Trail**
   - Log all user management operations
   - Log all authentication events (success/failure)
   - Log all privilege escalations
   - Log all data access (sensitive operations)
   - **Status**: ⚠️ Partial (has logging but not comprehensive audit trail)

6. **Remove Hardcoded Secrets**
   - Move all secrets to Azure Key Vault
   - Never commit secrets to repository
   - **Current**: `env-vars.json` contains secrets
   - **Status**: ❌ Critical issue

7. **Input Validation & Sanitization**
   - Validate all user inputs
   - Sanitize to prevent XSS
   - Use validation library (e.g., Joi, express-validator)
   - **Status**: ⚠️ Partial (some validation exists)

8. **Rate Limiting on Auth Endpoints**
   - Limit login attempts per IP
   - Prevent brute force attacks
   - **Status**: ⚠️ Missing on auth endpoints (exists on bulk operations)

### **Medium Priority - Should Implement**

9. **Multi-Factor Authentication (MFA)**
   - Required for admin accounts
   - Optional for regular users
   - **Status**: ❌ Not implemented

10. **Data Encryption at Rest**
    - Verify Azure database encryption
    - Encrypt sensitive fields in database
    - **Status**: ⚠️ Needs verification

11. **Backup & Disaster Recovery**
    - Document backup procedures
    - Test recovery procedures
    - Define RTO/RPO
    - **Status**: ⚠️ Needs documentation

12. **Security Policy Documentation**
    - Access control policy
    - Password policy
    - Incident response plan
    - **Status**: ❌ Missing

13. **Vulnerability Management**
    - Regular dependency scanning (npm audit)
    - Security patch management
    - **Status**: ⚠️ Needs process

14. **API Rate Limiting**
    - Global rate limiting
    - Per-user rate limiting
    - **Status**: ⚠️ Partial (only on bulk operations)

### **Low Priority - Nice to Have**

15. **Security Training Records**
    - Document security training for developers
    - **Status**: ❌ Missing

16. **Penetration Testing**
    - Regular security assessments
    - **Status**: ❌ Not done

17. **Security Certifications**
    - ISO 27001, ENS certification
    - **Status**: ❌ Not certified

---

## Part 4: Implementation Recommendations

### **Phase 1: Critical Security Fixes (Week 1-2)**

1. **Remove Hardcoded Secrets**
   - Move to Azure Key Vault
   - Update code to read from Key Vault
   - Remove `env-vars.json` from repository

2. **Add Security Headers**
   - Install and configure `helmet` middleware
   - Test headers with security scanner

3. **Implement Account Lockout**
   - Track failed login attempts
   - Lock account after threshold
   - Add unlock mechanism

4. **Enhance Password Policy**
   - Increase minimum length to 12
   - Add complexity requirements
   - Add password history

### **Phase 2: Authentication Improvements (Week 3-4)**

5. **Implement Refresh Tokens**
   - Add refresh token endpoint
   - Update JWT expiration strategy
   - Implement token revocation

6. **Add Rate Limiting to Auth**
   - Install `express-rate-limit`
   - Apply to login/reset password endpoints
   - Configure per-IP limits

7. **Comprehensive Audit Logging**
   - Create audit log model/table
   - Log all security events
   - Implement log retention policy

### **Phase 3: Documentation & Compliance (Week 5-6)**

8. **Security Documentation**
   - Write security policy
   - Document access control matrix
   - Create incident response plan
   - Document backup procedures

9. **Input Validation Enhancement**
   - Add validation middleware
   - Sanitize all inputs
   - Add XSS protection

10. **Security Testing**
    - Run dependency audit
    - Security code review
    - Penetration testing (if budget allows)

### **Phase 4: Advanced Security (Week 7-8)**

11. **Multi-Factor Authentication**
    - Implement TOTP-based MFA
    - Require for admin accounts
    - Optional for users

12. **Enhanced Monitoring**
    - Set up security alerts
    - Configure SIEM integration
    - Implement anomaly detection

---

## Part 5: Azure-Specific ENS Considerations

### **Azure Services You're Using**

1. **Azure App Service** (for hosting)
   - ✅ Managed SSL certificates
   - ✅ Built-in DDoS protection
   - ⚠️ Need to configure security headers
   - ⚠️ Need to enable diagnostic logging

2. **Azure MySQL Flexible Server**
   - ✅ SSL/TLS encryption in transit
   - ⚠️ Verify encryption at rest
   - ⚠️ Configure backup retention
   - ⚠️ Enable audit logging

3. **Azure Front Door**
   - ✅ DDoS protection
   - ✅ WAF (Web Application Firewall) - check if enabled
   - ⚠️ Configure security policies

4. **Azure Redis Cache**
   - ✅ SSL/TLS connections
   - ⚠️ Verify encryption at rest
   - ⚠️ Configure firewall rules

5. **Azure Application Insights**
   - ✅ Monitoring and logging
   - ⚠️ Configure security alerts
   - ⚠️ Set up log retention

### **Azure Security Best Practices**

- [ ] Enable Azure Security Center
- [ ] Configure Azure Key Vault for secrets
- [ ] Enable Azure Monitor alerts
- [ ] Configure network security groups
- [ ] Enable Azure DDoS Protection
- [ ] Configure Azure WAF rules
- [ ] Enable database audit logging
- [ ] Configure backup and retention policies
- [ ] Enable Azure AD integration (if applicable)
- [ ] Configure managed identities (avoid service principals)

---

## Part 6: Code-Specific Recommendations

### **Files That Need Security Updates**

1. **`index.js`**
   - Add `helmet` middleware
   - Add global rate limiting
   - Add security headers

2. **`controllers/user.controller.js`**
   - Add account lockout logic
   - Enhance password validation
   - Add audit logging for user operations

3. **`controllers/auth.controller.js`**
   - Add rate limiting
   - Implement refresh tokens
   - Add MFA support

4. **`middlewares/validateAdminToken.js`**
   - Standardize JWT secret usage
   - Add token refresh validation
   - Add session management

5. **`dbInit.js`**
   - Verify SSL configuration
   - Add connection encryption verification

6. **`config/config.js`**
   - Remove hardcoded credentials
   - Use Azure Key Vault

### **New Files to Create**

1. **`middlewares/securityHeaders.js`**
   - Custom security headers
   - CSP configuration

2. **`middlewares/rateLimiter.js`**
   - Global rate limiting
   - Per-endpoint rate limiting

3. **`middlewares/auditLogger.js`**
   - Security event logging
   - Audit trail management

4. **`utils/passwordPolicy.js`**
   - Password validation
   - Password strength checking

5. **`models/auditLog.model.js`**
   - Audit log database model
   - Security event storage

---

## Part 7: Compliance Certification Process

### **Steps to Achieve ENS Certification**

1. **Self-Assessment** (Current step)
   - Review this document
   - Identify gaps
   - Prioritize fixes

2. **Implementation**
   - Fix critical issues
   - Implement security controls
   - Document everything

3. **Internal Audit**
   - Review all controls
   - Test security measures
   - Fix remaining issues

4. **External Audit**
   - Hire certified auditor
   - Conduct security assessment
   - Get certification

5. **Maintenance**
   - Regular security reviews
   - Update documentation
   - Renew certification

### **Required Documentation**

- Security Policy Document
- Access Control Matrix
- Incident Response Plan
- Backup & Recovery Procedures
- Risk Assessment Report
- Security Training Records
- Audit Logs
- Change Management Procedures

---

## Part 8: Quick Wins (Can Implement Today)

1. **Install Helmet** (5 minutes)
   ```bash
   npm install helmet
   ```
   Add to `index.js`:
   ```javascript
   const helmet = require('helmet');
   app.use(helmet());
   ```

2. **Remove `env-vars.json` from Git** (10 minutes)
   - Add to `.gitignore`
   - Remove from repository history
   - Document required environment variables

3. **Add Rate Limiting to Login** (30 minutes)
   ```bash
   npm install express-rate-limit
   ```
   Apply to `/api/auth/login` endpoint

4. **Increase Password Minimum Length** (15 minutes)
   - Update validation in `auth.controller.js`
   - Change from 6 to 12 characters

5. **Add Security Headers Documentation** (20 minutes)
   - Document current security measures
   - Create security checklist

---

## Part 9: Estimated Effort & Timeline

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| Phase 1 | Critical fixes | 2 weeks | 🔴 Critical |
| Phase 2 | Auth improvements | 2 weeks | 🟠 High |
| Phase 3 | Documentation | 2 weeks | 🟡 Medium |
| Phase 4 | Advanced security | 2 weeks | 🟢 Low |
| **Total** | **All phases** | **8 weeks** | |

---

## Part 10: Resources & References

### **ENS Official Resources**
- ENS Website: https://ens.ccn.cni.es/
- ENS Navigable Framework: https://gobernanza.ccn-cert.cni.es/ens-navegable
- CCN-CERT Guides: https://www.ccn-cert.cni.es/

### **Azure Security Resources**
- Azure Security Best Practices: https://docs.microsoft.com/azure/security/
- Azure Key Vault: https://docs.microsoft.com/azure/key-vault/
- Azure Security Center: https://docs.microsoft.com/azure/security-center/

### **Node.js Security Resources**
- OWASP Node.js Security: https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html
- Node.js Security Checklist: https://blog.risingstack.com/node-js-security-checklist/

### **Tools & Libraries**
- Helmet.js: https://helmetjs.github.io/
- express-rate-limit: https://github.com/express-rate-limit/express-rate-limit
- express-validator: https://express-validator.github.io/docs/
- npm audit: Built-in dependency scanning

---

## Conclusion

Your application has a **solid security foundation** with authentication, logging, and basic security measures in place. However, to achieve **ENS compliance**, you need to address several critical gaps, particularly around:

1. **Secret management** (move to Azure Key Vault)
2. **Security headers** (implement helmet)
3. **Password policy** (strengthen requirements)
4. **Account security** (lockout mechanism)
5. **Audit logging** (comprehensive security events)
6. **Documentation** (security policies and procedures)

The good news is that most of these can be implemented incrementally without major architectural changes. Start with **Phase 1 (Critical Fixes)** and work through the phases systematically.

**Next Steps:**
1. Review this document with your team
2. Prioritize based on your business needs
3. Create a project plan
4. Begin implementation with Phase 1

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Prepared for:** FourO Backend Application  
**Hosting:** Azure (App Service, MySQL, Front Door, Redis)
