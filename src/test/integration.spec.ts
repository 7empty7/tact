import fs from 'fs';
import { __DANGER_resetNodeId } from '../grammar/ast';
import { compile, precompile } from '../main';
import { loadCases } from '../utils/loadCases';

describe('integration', () => {
    beforeEach(() => {
        __DANGER_resetNodeId();
    });
    for (let r of loadCases(__dirname + "/contracts/")) {
        it('should resolve expressions for ' + r.name, () => {
            let ctx = precompile(__dirname + "/contracts/" + r.name + '.tact');
            let res = compile(ctx);
            expect(res.output).toEqual(fs.readFileSync(__dirname + "/contracts/" + r.name + '.tact.fc', 'utf8'));
        });
    }
});