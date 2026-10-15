import json, os, pathlib, shutil, subprocess, tempfile, unittest

STAGE = pathlib.Path(__file__).resolve().parent
WRAPPER = STAGE/'pre-push' if (STAGE/'pre-push').is_file() else STAGE.parent/'pre-push'

class PushGuard(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='banzai push guard ', dir='/private/tmp'))
        self.addCleanup(shutil.rmtree, self.temp)
        self.repo = self.temp / 'source with spaces'
        self.remote = self.temp / 'remote.git'
        self.repo.mkdir()
        self.git('init', '--initial-branch=main')
        self.git('config', 'user.name', 'Local Hook Verification')
        self.git('config', 'user.email', 'hook-verification@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'tag.gpgsign', 'false')
        self.write('.gitignore', '/.banzai/*\n!/.banzai/artifacts.json\n/documentation/features/\n')
        self.write('.banzai/artifacts.json', json.dumps({'schema':'banzai-artifact-layout/v1','schemaVersion':1,'layout':'private'}))
        self.policy = {'schema':'banzai-publication-inventory/v1','schemaVersion':1,'mode':'clean','entries':[{'path':'README.md','classification':'maintainer','sha256':None}]}
        self.write('publication-policy.json', json.dumps(self.policy))
        self.write('README.md', '# Clean fixture\n')
        self.write('app.js', 'export const value = 1;\n')
        self.base = self.commit('Initial public fixture')
        hooks = self.repo / '.git/hooks'
        (hooks / 'banzai-publication').mkdir()
        shutil.copy2(WRAPPER, hooks/'pre-push')
        (hooks/'pre-push').chmod(0o755)
        for name in ['pre-push.mjs','publication-check.mjs']:
            shutil.copy2(STAGE/name, hooks/'banzai-publication'/name)
        subprocess.run(['git','init','--bare',str(self.remote)],check=True,capture_output=True)
        self.git('remote','add','origin',str(self.remote))
        self.push_ok('main')

    def git(self,*args,check=True,**kwargs):
        p = subprocess.run(['git',*args],cwd=self.repo,capture_output=True,text=True,**kwargs)
        if check and p.returncode:
            self.fail(f'git {args} failed: {p.stderr}')
        return p

    def write(self,name,text):
        p=self.repo/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(text)

    def commit(self,message,force=None):
        self.git('add','--all')
        if force: self.git('add','--force','--',force)
        self.git('commit','--allow-empty','-m',message)
        return self.git('rev-parse','HEAD').stdout.strip()

    def push_ok(self,*args):
        p=self.git('push','origin',*args,check=False)
        self.assertEqual(p.returncode,0,p.stderr)
        return p

    def refs(self):
        return subprocess.run(['git','show-ref'],cwd=self.remote,capture_output=True,text=True).stdout

    def push_blocked(self,*args):
        refs=self.refs()
        p=self.git('push','origin',*args,check=False)
        self.assertNotEqual(p.returncode,0)
        self.assertIn('Banzai pre-push: BLOCKED',p.stderr)
        self.assertEqual(self.refs(),refs,'A blocked push changed remote refs')
        return p

    def private_then_delete(self,pathname='.banzai/work/probe/work.md'):
        self.write(pathname,'PRIVATE_SENTINEL_NEVER_PRINT\n')
        bad=self.commit('Private evidence accidentally committed',force=pathname)
        (self.repo/pathname).unlink()
        self.commit('Delete private evidence from latest tree')
        return bad

    def test_clean_update_branch_and_annotated_tag(self):
        self.write('app.js','export const value = 2;\n')
        self.commit('Public update')
        self.git('branch','dev')
        self.git('tag','-a','v-test','-m','Public fixture tag')
        p=self.push_ok('--atomic','main','dev','refs/tags/v-test')
        self.assertIn('publication allowed',p.stderr)

    def test_private_file_deleted_later_still_blocks_before_transfer(self):
        bad=self.private_then_delete()
        p=self.push_blocked('main')
        self.assertIn(bad[:12],p.stderr)
        self.assertNotIn('PRIVATE_SENTINEL',p.stderr)
        remote_object=subprocess.run(['git','cat-file','-e',bad],cwd=self.remote,capture_output=True)
        self.assertNotEqual(remote_object.returncode,0,'Private commit reached the remote object store')

    def test_new_branch_ignores_forged_tracking_ref(self):
        self.git('checkout','-b','feature')
        self.private_then_delete()
        self.git('update-ref','refs/remotes/origin/forged','HEAD')
        self.push_blocked('feature')

    def test_force_push_checks_divergent_history(self):
        self.write('app.js','export const value = 2;\n'); self.commit('Remote public update'); self.push_ok('main')
        self.git('checkout','-B','rewrite',self.base)
        self.private_then_delete()
        self.push_blocked('--force','rewrite:main')

    def test_multiple_updates_block_together(self):
        self.git('branch','safe')
        self.git('checkout','-b','unsafe')
        self.private_then_delete()
        self.push_blocked('--atomic','safe','unsafe')

    def test_bad_annotated_tag_and_direct_blob_tag(self):
        bad=self.private_then_delete()
        self.git('tag','-a','bad-tag',bad,'-m','Fixture tag')
        self.push_blocked('refs/tags/bad-tag')
        blob=self.git('rev-parse',f'{self.base}:app.js').stdout.strip()
        self.git('tag','blob-tag',blob)
        self.push_blocked('refs/tags/blob-tag')

    def test_deletion_allowed_with_dirty_local_history(self):
        self.git('branch','delete-me'); self.push_ok('delete-me')
        self.private_then_delete()
        self.push_ok('--delete','delete-me')

    def test_export_ignore_does_not_hide_private_evidence(self):
        self.write('.gitattributes','.banzai/work/** export-ignore\n')
        self.write('.banzai/work/probe/work.md','Private fixture\n')
        self.commit('Export-ignore fixture',force='.banzai/work/probe/work.md')
        self.push_blocked('main')

    def test_reclassification_cannot_allow_legacy_reports(self):
        path='documentation/features/probe/work.md'
        self.policy['entries'].append({'path':path,'classification':'product','sha256':None})
        self.write('publication-policy.json',json.dumps(self.policy))
        self.write(path,'Private fixture\n')
        self.commit('Reclassified legacy fixture',force=path)
        self.push_blocked('main')

    def test_transition_is_blocked_and_existing_layout_is_inert(self):
        self.policy['mode']='transition'; self.write('publication-policy.json',json.dumps(self.policy)); self.commit('Transition fixture')
        self.push_blocked('main')
        self.git('reset','--hard',self.base)
        self.write('.banzai/artifacts.json',json.dumps({'schema':'banzai-artifact-layout/v1','schemaVersion':1,'layout':'legacy'})); self.commit('Legacy fixture')
        self.push_ok('main')

    def test_new_work_needs_no_inventory_or_layout_declaration(self):
        (self.repo/'.banzai/artifacts.json').unlink()
        self.write('documentation/work/new-work/plan.md','# Reviewable plan\n')
        self.write('documentation/work/new-work/review-1.md','# Review\n')
        self.commit('Tracked work without declaration')
        self.push_ok('main')

    def test_new_machine_evidence_deleted_later_still_blocks(self):
        for namespace in ['verification', 'execution-locks']:
            self.git('reset','--hard',self.base)
            self.private_then_delete(f'.banzai/{namespace}/probe/record.json')
            self.push_blocked('main')

    def test_missing_policy_and_symlink_fail_closed(self):
        (self.repo/'publication-policy.json').unlink(); self.commit('Missing policy fixture')
        self.push_blocked('main')
        self.git('reset','--hard',self.base)
        (self.repo/'link.js').symlink_to('app.js'); self.commit('Symlink fixture')
        self.push_blocked('main')

    def test_merge_parents_are_checked(self):
        self.git('checkout','-b','feature'); self.private_then_delete()
        self.git('checkout','main'); self.git('merge','--no-ff','feature','-m','Merge clean final feature tree')
        self.push_blocked('main')

    def test_working_checker_and_git_replace_cannot_hide_history(self):
        bad=self.private_then_delete()
        self.write('packages/orchestrator/scripts/publication-check.mjs','throw new Error("CHECKOUT_CODE_MUST_NOT_EXECUTE");\n')
        self.git('replace',bad,self.base)
        p=self.push_blocked('--force','main')
        self.assertNotIn('CHECKOUT_CODE_MUST_NOT_EXECUTE',p.stderr)

    def test_shallow_checkout_blocks(self):
        shallow=self.temp/'shallow'
        subprocess.run(['git','clone','--depth','1',self.remote.as_uri(),str(shallow)],check=True,capture_output=True)
        # Bare fixture defaults to master; select the explicitly published main.
        if not (shallow/'.git/shallow').exists():
            shutil.rmtree(shallow)
            subprocess.run(['git','clone','--depth','1','--branch','main',self.remote.as_uri(),str(shallow)],check=True,capture_output=True)
        hooks=shallow/'.git/hooks'
        shutil.copytree(self.repo/'.git/hooks/banzai-publication',hooks/'banzai-publication')
        shutil.copy2(self.repo/'.git/hooks/pre-push',hooks/'pre-push')
        p=subprocess.run(['git','push','origin','HEAD:refs/heads/shallow-new'],cwd=shallow,capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0)
        self.assertIn('unshallow',p.stderr)

    def test_unknown_remote_oid_checks_all_available_history(self):
        self.private_then_delete()
        tip=self.git('rev-parse','HEAD').stdout.strip()
        data=f'refs/heads/main {tip} refs/heads/main '+('f'*40)+'\n'
        p=subprocess.run([str(self.repo/'.git/hooks/pre-push'),'origin',str(self.remote)],cwd=self.repo,input=data,capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0)
        self.assertIn('BLOCKED',p.stderr)

if __name__=='__main__': unittest.main(verbosity=2)
