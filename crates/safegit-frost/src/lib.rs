use rand::{CryptoRng, RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThresholdPolicy {
    pub required: u8,
    pub total: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFrostSignature {
    pub verifying_key_bytes: [u8; 32],
    pub signature_bytes: [u8; 64],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFrostKeygen {
    pub verifying_key_bytes: [u8; 32],
    pub public_key_package_bytes: Vec<u8>,
    pub key_package_bytes: Vec<Vec<u8>>,
}

impl ThresholdPolicy {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.required == 0 || self.total == 0 {
            return Err("threshold values must be positive");
        }
        if self.required > self.total {
            return Err("required threshold cannot exceed total participants");
        }
        Ok(())
    }
}

pub fn trusted_dealer_keygen(policy: ThresholdPolicy) -> Result<LocalFrostKeygen, String> {
    let mut rng = rand::rngs::OsRng;
    trusted_dealer_keygen_with_rng(policy, &mut rng)
}

fn trusted_dealer_keygen_with_rng<R>(
    policy: ThresholdPolicy,
    rng: &mut R,
) -> Result<LocalFrostKeygen, String>
where
    R: RngCore + CryptoRng,
{
    policy.validate().map_err(str::to_owned)?;
    let (shares, public_key_package) = frost_ed25519::keys::generate_with_dealer(
        policy.total.into(),
        policy.required.into(),
        frost_ed25519::keys::IdentifierList::Default,
        rng,
    )
    .map_err(|error| format!("dealer keygen failed: {error:?}"))?;

    let mut key_package_bytes = Vec::new();
    for (_, secret_share) in shares {
        let key_package = frost_ed25519::keys::KeyPackage::try_from(secret_share)
            .map_err(|error| format!("key package validation failed: {error:?}"))?;
        key_package_bytes.push(
            key_package
                .serialize()
                .map_err(|error| format!("key package serialization failed: {error:?}"))?,
        );
    }

    let verifying_key_vec = public_key_package
        .verifying_key()
        .serialize()
        .map_err(|error| format!("verifying key serialization failed: {error:?}"))?;
    Ok(LocalFrostKeygen {
        verifying_key_bytes: verifying_key_vec
            .try_into()
            .map_err(|_| "verifying key was not 32 bytes".to_owned())?,
        public_key_package_bytes: public_key_package
            .serialize()
            .map_err(|error| format!("public key package serialization failed: {error:?}"))?,
        key_package_bytes,
    })
}

pub fn trusted_dealer_sign_demo(
    message: &[u8],
    policy: ThresholdPolicy,
) -> Result<LocalFrostSignature, String> {
    let mut rng = rand::rngs::OsRng;
    trusted_dealer_sign_demo_with_rng(message, policy, &mut rng)
}

pub fn trusted_dealer_sign_demo_with_seed(
    message: &[u8],
    policy: ThresholdPolicy,
    seed: [u8; 32],
) -> Result<LocalFrostSignature, String> {
    let mut rng = ChaCha20Rng::from_seed(seed);
    trusted_dealer_sign_demo_with_rng(message, policy, &mut rng)
}

pub fn sign_with_key_packages(
    message: &[u8],
    public_key_package_bytes: &[u8],
    key_package_bytes: &[Vec<u8>],
) -> Result<LocalFrostSignature, String> {
    let public_key_package =
        frost_ed25519::keys::PublicKeyPackage::deserialize(public_key_package_bytes)
            .map_err(|error| format!("public key package deserialization failed: {error:?}"))?;
    let mut rng = rand::rngs::OsRng;
    let mut key_packages = std::collections::BTreeMap::new();
    for bytes in key_package_bytes {
        let key_package = frost_ed25519::keys::KeyPackage::deserialize(bytes)
            .map_err(|error| format!("key package deserialization failed: {error:?}"))?;
        key_packages.insert(*key_package.identifier(), key_package);
    }
    sign_with_loaded_key_packages(message, &public_key_package, &key_packages, &mut rng)
}

fn trusted_dealer_sign_demo_with_rng<R>(
    message: &[u8],
    policy: ThresholdPolicy,
    rng: &mut R,
) -> Result<LocalFrostSignature, String>
where
    R: RngCore + CryptoRng,
{
    policy.validate().map_err(str::to_owned)?;
    let (shares, public_key_package) = frost_ed25519::keys::generate_with_dealer(
        policy.total.into(),
        policy.required.into(),
        frost_ed25519::keys::IdentifierList::Default,
        &mut *rng,
    )
    .map_err(|error| format!("dealer keygen failed: {error:?}"))?;

    let mut key_packages = std::collections::BTreeMap::new();
    for (identifier, secret_share) in shares {
        let key_package = frost_ed25519::keys::KeyPackage::try_from(secret_share)
            .map_err(|error| format!("key package validation failed: {error:?}"))?;
        key_packages.insert(identifier, key_package);
    }

    sign_with_loaded_key_packages(message, &public_key_package, &key_packages, rng)
}

fn sign_with_loaded_key_packages<R>(
    message: &[u8],
    public_key_package: &frost_ed25519::keys::PublicKeyPackage,
    key_packages: &std::collections::BTreeMap<
        frost_ed25519::Identifier,
        frost_ed25519::keys::KeyPackage,
    >,
    rng: &mut R,
) -> Result<LocalFrostSignature, String>
where
    R: RngCore + CryptoRng,
{
    let mut nonces_map = std::collections::BTreeMap::new();
    let mut commitments_map = std::collections::BTreeMap::new();
    for (identifier, key_package) in key_packages {
        let (nonces, commitments) =
            frost_ed25519::round1::commit(key_package.signing_share(), &mut *rng);
        nonces_map.insert(*identifier, nonces);
        commitments_map.insert(*identifier, commitments);
    }

    let signing_package = frost_ed25519::SigningPackage::new(commitments_map, message);
    let mut signature_shares = std::collections::BTreeMap::new();
    for (identifier, nonces) in &nonces_map {
        let key_package = key_packages
            .get(identifier)
            .ok_or_else(|| format!("missing key package for signer {identifier:?}"))?;
        let signature_share = frost_ed25519::round2::sign(&signing_package, nonces, key_package)
            .map_err(|error| format!("round2 signing failed: {error:?}"))?;
        signature_shares.insert(*identifier, signature_share);
    }

    let signature =
        frost_ed25519::aggregate(&signing_package, &signature_shares, public_key_package)
            .map_err(|error| format!("aggregation failed: {error:?}"))?;
    public_key_package
        .verifying_key()
        .verify(message, &signature)
        .map_err(|error| format!("group signature verification failed: {error:?}"))?;

    let verifying_key_vec = public_key_package
        .verifying_key()
        .serialize()
        .map_err(|error| format!("verifying key serialization failed: {error:?}"))?;
    let signature_vec = signature
        .serialize()
        .map_err(|error| format!("signature serialization failed: {error:?}"))?;
    Ok(LocalFrostSignature {
        verifying_key_bytes: verifying_key_vec
            .try_into()
            .map_err(|_| "verifying key was not 32 bytes".to_owned())?,
        signature_bytes: signature_vec
            .try_into()
            .map_err(|_| "signature was not 64 bytes".to_owned())?,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        ThresholdPolicy, sign_with_key_packages, trusted_dealer_keygen, trusted_dealer_sign_demo,
        trusted_dealer_sign_demo_with_seed,
    };

    #[test]
    fn validates_threshold() {
        assert!(
            ThresholdPolicy {
                required: 2,
                total: 3
            }
            .validate()
            .is_ok()
        );
        assert!(
            ThresholdPolicy {
                required: 4,
                total: 3
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn local_two_of_three_frost_signature_verifies() {
        let message = b"safe-git-threshold local frost proof";
        let result = trusted_dealer_sign_demo(
            message,
            ThresholdPolicy {
                required: 2,
                total: 3,
            },
        )
        .expect("local FROST signing succeeds");
        assert_eq!(result.verifying_key_bytes.len(), 32);
        assert_eq!(result.signature_bytes.len(), 64);

        let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&result.verifying_key_bytes)
            .expect("FROST verifying key is an Ed25519 public key");
        let signature = ed25519_dalek::Signature::from_bytes(&result.signature_bytes);
        ed25519_dalek::Verifier::verify(&verifying_key, message, &signature)
            .expect("aggregate signature verifies as ordinary Ed25519");
    }

    #[test]
    fn seeded_demo_signature_is_reproducible() {
        let seed = [7u8; 32];
        let policy = ThresholdPolicy {
            required: 2,
            total: 3,
        };
        let left = trusted_dealer_sign_demo_with_seed(
            b"safe-git-threshold seeded demo",
            policy.clone(),
            seed,
        )
        .expect("seeded local FROST signing succeeds");
        let right =
            trusted_dealer_sign_demo_with_seed(b"safe-git-threshold seeded demo", policy, seed)
                .expect("seeded local FROST signing succeeds");
        assert_eq!(left, right);
    }

    #[test]
    fn trusted_dealer_key_packages_can_sign_without_reconstructing_group_secret() {
        let message = b"safe-git-threshold stored key package proof";
        let ceremony = trusted_dealer_keygen(ThresholdPolicy {
            required: 2,
            total: 3,
        })
        .expect("trusted dealer ceremony succeeds");

        let proof = sign_with_key_packages(
            message,
            &ceremony.public_key_package_bytes,
            &ceremony.key_package_bytes[0..2].to_vec(),
        )
        .expect("stored key packages sign");

        assert_eq!(proof.verifying_key_bytes, ceremony.verifying_key_bytes);
        let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&proof.verifying_key_bytes)
            .expect("FROST verifying key is an Ed25519 public key");
        let signature = ed25519_dalek::Signature::from_bytes(&proof.signature_bytes);
        ed25519_dalek::Verifier::verify(&verifying_key, message, &signature)
            .expect("stored-key aggregate signature verifies as ordinary Ed25519");
    }
}
