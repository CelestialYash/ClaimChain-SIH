import { network } from "hardhat";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

async function main() {
  const connection = await network.create();
  const networkName: string = (connection as any).networkName ?? "unknown";
  const ethersExt = (connection as any).ethers;

  const [deployer] = await ethersExt.getSigners();
  console.log(`Deploying ClaimAuditTrail with ${deployer.address} on network "${networkName}"...`);

  const factory = await ethersExt.getContractFactory("ClaimAuditTrail");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = contract.target as string;
  console.log(`ClaimAuditTrail deployed at ${address}`);

  const dir = path.resolve("deployments");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${networkName}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        contract: "ClaimAuditTrail",
        address,
        network: networkName,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`Deployment info written to ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
