import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dfsRouter from "./dfs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dfsRouter);

export default router;
